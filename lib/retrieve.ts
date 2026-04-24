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
                system: "You are a Query Contextualizer. Based on the chat history, rewrite the user's latest message into a standalone search query. Example: 'who is srinivasan' -> 'tell me more about him' becomes 'Further details about Dr. K. S. Srinivasan'. If the input is just small talk (hi, thanks, cool), return it as is. Respond ONLY with the query.",
                prompt: `History:\n${history.map(h => `${h.role}: ${h.content}`).join('\n')}\n\nUser: ${rawQuery}`
            });
            contextualizedQuery = text.trim();
        } catch (e) { console.error('Contextualization failed:', e); }
    }

    // --- STAGE 2: INTENT DETECTION ---
    const lowerQuery = contextualizedQuery.toLowerCase();
    const isSmallTalk = history.length > 0 && (lowerQuery.length < 15 || /^(nice|cool|great|thanks|ok|wow|hello|hi)/.test(lowerQuery));

    // --- STAGE 3: HYBRID RETRIEVAL ---
    let finalChunks: string[] = [];
    let topScore = 0;
    
    // Skip heavy search for clear small talk to stay responsive
    if (!isSmallTalk) {
        try {
            const { embedding } = await embed({ model: openai.embedding('text-embedding-3-small'), value: contextualizedQuery });
            const searchResults = await qdrant.search(COLLECTION_NAME, { vector: embedding, limit: 10, with_payload: true });
            
            // Re-rank and score
            if (searchResults.length > 0) {
                const results = searchResults.map(res => {
                    const content = (res.payload?.content as string || '').toLowerCase();
                    const words = contextualizedQuery.toLowerCase().split(' ').filter(w => w.length > 3);
                    let matches = 0;
                    words.forEach(w => { if (content.includes(w)) matches++; });
                    const bonus = words.length > 0 ? (matches / words.length) * 0.2 : 0;
                    return { content: res.payload?.content as string, score: res.score + bonus };
                });
                results.sort((a, b) => b.score - a.score);
                topScore = results[0].score;
                finalChunks = results.slice(0, 5).map(r => r.content);
            }
        } catch (err) { console.error('Retrieval error:', err); }
    }

    // --- STAGE 4: GROUNDED GENERATION ---
    // Instruction: Never say "I don't know" if the history has enough info to be helpful.
    const context = finalChunks.join('\n\n---\n\n');
    let finalAnswer = "I'm sorry, I don't have specific details on that in my MSAJCE database. Could you ask about our departments, transport, or admissions?";

    try {
        const { text, usage } = await generateText({
            model: openai(modelId),
            system: `You are Lorin, the smart AI Concierge for MSAJCE Engineering College. 
            MISSION: Provide highly accurate, friendly information to students.
            GUIDELINES:
            1. PERSISTENCE: Use Chat History to resolve pronouns (him/it/that).
            2. CONTEXT FIRST: If 'Context' is provided, use it as the primary source.
            3. SENTIMENT: If the user is being friendly or making small-talk, reply warmly as a campus buddy.
            4. ACCURACY: If you truly cannot find info in context OR history, politely say so.
            PERSONA: Energetic, professional, and slightly casual (campus-buddy style).`,
            prompt: `Context:\n${context || 'No specific metadata found for this query.'}\n\nChat History:\n${history.map(h => `${h.role}: ${h.content}`).join('\n')}\n\nLatest Input: ${rawQuery}`
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
