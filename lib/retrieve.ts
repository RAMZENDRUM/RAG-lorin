import { QdrantClient } from '@qdrant/js-client-rest';
import { embed, generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { CohereClient } from 'cohere-ai';
import dotenv from 'dotenv';
import crypto from 'crypto';
import fs from 'fs-extra';
import path from 'path';

dotenv.config();

const COLLECTION_NAME = 'lorin_msajce_knowledge';

const VERCEL_KEYS = [
    process.env.VERCEL_AI_KEY,
    process.env.VERCEL_AI_KEY_2,
    process.env.VERCEL_AI_KEY_3,
    process.env.VERCEL_AI_KEY_4
].filter(Boolean) as string[];

let currentKeyIndex = 0; // Default to first available key

function getOpenAI() {
    // Ensure we pick a valid key if available
    const keyToUse = VERCEL_KEYS.length > 0 
        ? VERCEL_KEYS[Math.min(currentKeyIndex, VERCEL_KEYS.length - 1)] 
        : process.env.VERCEL_AI_KEY; 

    return createOpenAI({ 
        apiKey: keyToUse || '',
        baseURL: 'https://ai-gateway.vercel.sh/v1'
    });
}

const qdrant = new QdrantClient({
    url: process.env.QDRANT_URL,
    apiKey: process.env.QDRANT_API_KEY
});

const cohere = new CohereClient({
    token: process.env.COHERE_API_KEY || ''
});

// Cache for exact preservation
const responseCache = new Map<string, string>();

function normalizeQuery(query: string): string {
    return query.toLowerCase().trim().replace(/\s+/g, ' ');
}

function processRouter(normalizedQuery: string) {
    const intent: string[] = [];
    if (normalizedQuery.includes('bus') || normalizedQuery.includes('transport') || normalizedQuery.includes('route')) {
        intent.push('transport');
    }
    if (normalizedQuery.includes('hostel') || normalizedQuery.includes('room') || normalizedQuery.includes('mess')) {
        intent.push('hostel');
    }
    if (normalizedQuery.includes('admission')) {
        intent.push('admission');
    }
    return intent.length > 0 ? intent[0] : null;
}


export interface RetrievalResult {
    answer: string;
    score: number;
    source: string;
}

export interface InteractionLog {
    timestamp: string;
    userId: string;
    sessionId: string;
    query: string;
    answer: string;
    source: string;
    latency: number;
    tokens: number;
    cost: number;
    spam: boolean;
    abuse: boolean;
    score: number;
    k: number;
    model: string;
}

export async function performLorinRetrieval(
    rawQuery: string, 
    userId: string | number, 
    sessionId: string,
    history: ChatMessage[] = []
): Promise<RetrievalResult> {
    const startTime = Date.now();
    const openai = getOpenAI();
    let tokensUsed = 0;
    let modelId = 'gpt-4o-mini';

    // --- STAGE 1: SEMANTIC CONTEXTUALIZATION ---
    // Universal fix for pronouns (him, it, that) and follow-ups ("tell me more")
    let contextualizedQuery = normalizeQuery(rawQuery);
    if (history.length > 0) {
        try {
            const { text } = await generateText({
                model: openai('gpt-4o-mini'),
                system: `You are a Search Query contextualizer. 
                - Rewrite the User's question into a standalone search query.
                - CRITICAL: Prioritize the most RECENT person/entity mentioned in the history.
                - If the user says 'him' and the very last assistant message was about 'Dr. Srinivasan', the query MUST include 'Dr. K. S. Srinivasan'.
                - Don't bring up the developer (Ram) unless the user specifically asks about the developer.`,
                prompt: `History:\n${history.map(h => `${h.role}: ${h.content}`).join('\n')}\n\nUser: ${rawQuery}`
            });
            contextualizedQuery = text.trim();
        } catch (e) { console.error('Contextualization failed:', e); }
    }

    // --- STAGE 2: INTENT DETECTION ---
    const lowerQuery = contextualizedQuery.toLowerCase();
    const isSmallTalk = history.length > 0 && (lowerQuery.length < 15 || /^(nice|cool|great|thanks|ok|wow|hello|hi|that)/.test(lowerQuery));

    // --- STAGE 3: HYBRID RETRIEVAL ---
    let finalChunks: string[] = [];
    let topScore = 0;
    
    if (!isSmallTalk) {
        try {
            const { embedding } = await embed({ model: openai.embedding('text-embedding-3-small'), value: contextualizedQuery });
            const searchResults = await qdrant.search(COLLECTION_NAME, { vector: embedding, limit: 12, with_payload: true });
            
            if (searchResults.length > 0) {
                const results = searchResults.map(res => {
                    const content = (res.payload?.content as string || '').toLowerCase();
                    const words = contextualizedQuery.toLowerCase().split(' ').filter(w => w.length > 3);
                    let matches = 0;
                    words.forEach(w => { if (content.includes(w)) matches++; });
                    const bonus = words.length > 0 ? (matches / words.length) * 0.25 : 0;
                    return { content: res.payload?.content as string, score: res.score + bonus };
                });
                results.sort((a, b) => b.score - a.score);
                topScore = results[0].score;
                finalChunks = results.slice(0, 5).map(r => r.content);
            }
        } catch (err) { console.error('Retrieval error:', err); }
    }

    // --- STAGE 4: GROUNDED GENERATION ---
    const context = finalChunks.join('\n\n---\n\n');
    try {
        const { text, usage } = await generateText({
            model: openai(modelId),
            system: `You are Lorin, the lively and super-helpful MSAJCE AI Concierge! 🎓✨
            PERSONA: You are like a friendly senior student at Mohamed Sathak AJ College of Engineering. 
            TONE: Energetic, warm, and conversational. Use emojis naturally (🚀, 🎓, 📍, 📞). 

            VITAL RULES:
            1. BE ALIVE: Don't just dump info. Start with a warm opening and end with an interactive question to keep the chat going.
            2. NO ROBOTS: Never say "I don't have that info" in a cold way. If data is missing, say something like "Ooh, I don't have that specific detail in our library yet, but I can help you find out from the office! Want to know something else?"
            3. PRONOUNS: Use history to know who 'him' is. If you just mentioned Dr. Srinivasan, stay on him!
            4. CONTACTS: Always make phone numbers clickable (+91 91505 75066) and bold key details.
            5. FORMATTING: Use bullet points and bold text to make your "campus tips" easy to read on a phone screen.`,
            prompt: `Context Documents:\n${context || 'No specific library files found for this.'}\n\nRecent Chat Memory:\n${history.map(h => `${h.role}: ${h.content}`).join('\n')}\n\nYour Friend says: ${rawQuery}`
        });
        finalAnswer = text;
        tokensUsed = (usage.promptTokens || 0) + (usage.completionTokens || 0);
    } catch (err) { console.error('Generation error:', err); }

    // --- STAGE 5: AUDIT LOGGING ---
    await logInteraction({
        timestamp: new Date().toISOString(),
        userId: userId.toString(), sessionId, query: rawQuery, answer: finalAnswer,
        source: contextualizedQuery !== rawQuery ? 'REWRITTEN_RAG' : (context ? 'DIRECT_RAG' : 'PERSONA'),
        latency: Date.now() - startTime, tokens: tokensUsed, cost: (tokensUsed / 1000) * 0.00015,
        spam: false, abuse: false, score: topScore, k: finalChunks.length, model: modelId
    });

    return { answer: finalAnswer, score: topScore, source: 'live' };
}

async function logInteraction(data: InteractionLog) {
    if (process.env.VERCEL) {
        console.log('Interaction Log:', JSON.stringify(data));
        return;
    }
    
    try {
        const logDir = path.join(process.cwd(), 'logs');
        await fs.ensureDir(logDir);
        const logFile = path.join(logDir, 'audit.jsonl');
        await fs.appendFile(logFile, JSON.stringify(data) + '\n');
    } catch (error) {
        console.error('Failed to log interaction to file:', error);
    }
}
