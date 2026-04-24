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
    const normalizedQuery = normalizeQuery(rawQuery);
    const openai = getOpenAI();
    
    let retrievalSource = 'QDRANT_VECTOR';
    let topScore = 0;
    let kChunks = 0;
    let tokensUsed = 0;
    let modelId = 'gpt-4o-mini';

    // 1. Exact Match / Sentinel (Fuzzy)
    const q = normalizedQuery.toLowerCase();
    let sentinelAnswer: string | null = null;
    if (q.includes('principal') || q.includes('srinivasan')) {
        sentinelAnswer = "Dr. K. S. Srinivasan is the Principal and President of MSAJCE. He is a visionary leader dedicated to innovation and student welfare.";
    }
    if (q.includes('ramzendrum') || q.includes('ramanathan')) {
        sentinelAnswer = "Ramanathan S (Ramzendrum) is a second-year B.Tech IT student at MSAJCE and the developer who built my brain!";
    }

    if (sentinelAnswer) {
        return { answer: sentinelAnswer, score: 1.0, source: 'sentinel' };
    }

    // 2. Query Rewriting (Contextualization)
    let searchLibraryQuery = normalizedQuery;
    if (history.length > 0) {
        try {
            const { text: rewritten } = await generateText({
                model: openai('gpt-4o-mini'),
                system: "You are a query contextualizer. Rewrite the user's latest question to be a standalone search query based on the provided chat history. If it's already clear or just a pleasantry, return it as is. ONLY return the rewritten query.",
                prompt: `History:\n${history.map(h => `${h.role}: ${h.content}`).join('\n')}\n\nLatest Question: ${normalizedQuery}`
            });
            searchLibraryQuery = rewritten.trim();
        } catch (e) { console.error('Rewriting error:', e); }
    }

    // 3. Retrieval Pipeline (Search for the contextualized query)
    let finalChunks: string[] = [];
    try {
        const { embedding } = await embed({ model: openai.embedding('text-embedding-3-small'), value: searchLibraryQuery });
        const primaryIntent = processRouter(searchLibraryQuery);
        
        let vectorResults: any[] = await qdrant.search(COLLECTION_NAME, {
            vector: embedding, 
            limit: 5, 
            with_payload: true,
            filter: primaryIntent ? { must: [{key: 'category', match: {value: primaryIntent}}]} : undefined
        });
        
        if (vectorResults.length === 0) {
            vectorResults = await qdrant.search(COLLECTION_NAME, { vector: embedding, limit: 5, with_payload: true });
        }

        const cleanQuery = searchLibraryQuery.replace(/[^\w\s]/g, '');
        const keywords = cleanQuery.split(/\s+/).filter(w => w.length > 3);
        const resultsWithHybridScore = vectorResults.map(res => {
            const content = (res.payload?.content as string || '').toLowerCase();
            let matches = 0;
            keywords.forEach(word => { if (content.includes(word)) matches++; });
            const keywordScore = keywords.length > 0 ? matches / keywords.length : 0;
            return { ...res, hybridScore: (0.85 * res.score) + (0.15 * keywordScore) };
        });
        
        resultsWithHybridScore.sort((a, b) => b.hybridScore - a.hybridScore);
        topScore = resultsWithHybridScore[0]?.hybridScore || 0;
        finalChunks = resultsWithHybridScore.map(r => r.payload?.content as string);
    } catch (err) {
        console.error('Retrieval error:', err);
    }

    kChunks = finalChunks.length;

    // 4. Generation Pipeline (Always call LLM to handle small talk/history even if 0 chunks)
    const context = finalChunks.join('\n\n---\n\n');
    let answerText = "I'm sorry, I couldn't find any specific details about that in my college records. Could you ask something else about MSAJCE?";
    
    try {
        const { text: answer, usage } = await generateText({
            model: openai(modelId),
            system: `You are Lorin, the MSAJCE AI Concierge. 
            - Answer based on the Context if possible.
            - Use Chat History to stay on topic (e.g., "him" refers to the person previously discussed).
            - If it's a pleasantry (like "that's nice"), respond warmly.
            - Be a helpful, energetic campus buddy.`,
            prompt: `Context:\n${context || 'No specific document chunks found.'}\n\nChat History:\n${history.map(h => `${h.role}: ${h.content}`).join('\n')}\n\nUser: ${normalizedQuery}`
        });
        answerText = answer;
        tokensUsed = (usage.promptTokens || 0) + (usage.completionTokens || 0);
    } catch(err) { 
        console.error('Generation error:', err);
    }

    // 5. Final Audit Logging
    await logInteraction({
        timestamp: new Date().toISOString(),
        userId: userId.toString(),
        sessionId,
        query: rawQuery,
        answer: answerText,
        source: context ? retrievalSource : 'LLM_ONLY',
        latency: Date.now() - startTime,
        tokens: tokensUsed,
        cost: (tokensUsed / 1000) * 0.00015,
        spam: false,
        abuse: /(bad|worst|scam|waste)/i.test(rawQuery), 
        score: topScore,
        k: kChunks,
        model: modelId
    });

    return { answer: answerText, score: topScore, source: 'live' };
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
