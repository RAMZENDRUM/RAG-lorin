import crypto from 'crypto';
import { generateText, embed } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { QdrantClient } from '@qdrant/js-client-rest';
import { CohereClient } from 'cohere-ai';
import dotenv from 'dotenv';

dotenv.config();

// --- CONFIG ---
const COLLECTION_NAME = 'lorin_rag_core';
const qdrant = new QdrantClient({
    url: process.env.QDRANT_URL,
    apiKey: process.env.QDRANT_API_KEY
});

const cohere = new CohereClient({
    token: process.env.COHERE_API_KEY || ''
});

const responseCache = new Map<string, string>();

// --- UTILS ---
export function normalizeQuery(q: string): string {
    return q.trim().toLowerCase().replace(/[?]/g, '');
}

function getOpenAI() {
    const keys = [
        process.env.VERCEL_AI_KEY,
        process.env.VERCEL_AI_KEY_2,
        process.env.VERCEL_AI_KEY_3,
        process.env.OPENAI_API_KEY
    ].filter(Boolean) as string[];
    
    if (keys.length === 0) throw new Error('No OpenAI API Keys found in environment!');
    
    // Simple rotation
    const key = keys[Math.floor(Math.random() * keys.length)];
    return createOpenAI({ apiKey: key });
}

// --- CORE PIPELINE ---
export interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
}

export interface RetrievalResult {
    answer: string;
    score: number;
    source: string;
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

    // 1. Contextualize Query (Convert pronouns/vague bits based on history)
    let contextualizedQuery = normalizeQuery(rawQuery);
    if (history.length > 0) {
        try {
            const { text } = await generateText({
                model: openai('gpt-4o-mini'),
                system: "You are a Search Contextualizer. Full chat history is provided. Rewrite the user's latest query as a standalone search query. Prioritize the MOST RECENT subject in the chat. ONLY return the query.",
                prompt: `History:\n${history.map(h => `${h.role}: ${h.content}`).join('\n')}\n\nLast Message: ${rawQuery}`
            });
            contextualizedQuery = text.trim();
        } catch (e) {
            console.error('Rewriting failed, using raw query');
        }
    }

    // 2. Identify Intent
    const isSmallTalk = history.length > 0 && /^(nice|thanks|cool|ok|wow|hi|hello|great|that)/i.test(contextualizedQuery) && contextualizedQuery.length < 20;

    // 3. Search
    let context = "No specific data found.";
    let topScore = 0;

    if (!isSmallTalk) {
        try {
            const { embedding } = await embed({ 
                model: openai.embedding('text-embedding-3-small'), 
                value: contextualizedQuery 
            });
            
            const results = await qdrant.search(COLLECTION_NAME, { 
                vector: embedding, 
                limit: 5, 
                with_payload: true 
            });

            if (results.length > 0) {
                topScore = results[0].score;
                context = results.map(r => r.payload?.content as string).join('\n\n---\n\n');
            }
        } catch (err) {
            console.error('Search error:', err);
        }
    }

    // 4. Generate
    let finalAnswer = "I'm sorry, I'm having trouble accessing my college knowledge right now. Ask me again in a moment!";
    try {
        const { text, usage } = await generateText({
            model: openai('gpt-4o-mini'),
            system: `You are Lorin, the smart AI Concierge for MSAJCE. 
            - Use Context to answer.
            - Use History to stay interactive.
            - Treat phone numbers as clickable (+91 91505 75066).
            - Be a friendly campus buddy! ✨`,
            prompt: `Context:\n${context}\n\nHistory:\n${history.map(h => `${h.role}: ${h.content}`).join('\n')}\n\nUser: ${rawQuery}`
        });
        finalAnswer = text;
        tokensUsed = (usage.promptTokens || 0) + (usage.completionTokens || 0);
    } catch (err) {
        console.error('Generation error:', err);
    }

    // 5. Final Diagnostic Log (To Vercel console)
    console.log(`[Lorin] User:${userId} | Latency:${Date.now() - startTime}ms | Score:${topScore.toFixed(3)} | Query:${contextualizedQuery}`);

    return { answer: finalAnswer, score: topScore, source: 'live' };
}
