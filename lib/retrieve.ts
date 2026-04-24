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
    const queryId = crypto.createHash('md5').update(rawQuery).digest('hex');
    const query = normalizeQuery(rawQuery);
    
    let retrievalSource = 'QDRANT_VECTOR';
    let topScore = 0;
    let kChunks = 0;
    let tokensUsed = 0;
    let modelId = 'gpt-4o-mini';

    // 1. Context Cache Check
    if (responseCache.has(queryId)) {
        const answer = responseCache.get(queryId)!;
        await logInteraction({
            timestamp: new Date().toISOString(),
            userId: userId.toString(),
            sessionId,
            query: rawQuery,
            answer,
            source: 'CACHE',
            latency: Date.now() - startTime,
            tokens: 0,
            cost: 0,
            spam: false,
            abuse: false,
            score: 1.0,
            k: 0,
            model: 'N/A'
        });
        return { answer, source: 'cache', score: 1.0 };
    }
    
    // 2. Exact Match / Sentinel
    let sentinelAnswer: string | null = null;
    const q = query.toLowerCase();
    
    if (q === 'who is the principal' || q === 'who is principal') sentinelAnswer = "Dr. K. S. Srinivasan is the President and Principal of MSAJCE.";
    const isRam = q.includes('ramzendrum') || q.includes('ramanathan') || /\bram\b/.test(q) || /\brama\b/.test(q);
    
    if (q.includes('tambaram')) sentinelAnswer = "For **Tambaram**, you should use **Route R 21 (formerly AR 10 - Porur to College)**. It reaches **Tambaram W & E at 07:00 AM**.\n\nShould I provide the full list of stops for R 21?";
    if (q.includes('sipcot')) sentinelAnswer = "MSAJCE is located inside SIPCOT IT Park! Most college buses (AR3-AR10 and R21/R22) reach the **SIPCOT Entrance / SIPCOT IT Park** between **07:45 AM and 07:55 AM** before arriving at the college gate at 08:00 AM.";
    if (isRam) sentinelAnswer = "Ramanathan S (Ramzendrum) is a second-year B.Tech IT student at MSAJCE and the creator of my brain (Lorin).";

    if (sentinelAnswer) {
        await logInteraction({
            timestamp: new Date().toISOString(),
            userId: userId.toString(),
            sessionId,
            query: rawQuery,
            answer: sentinelAnswer,
            source: 'SENTINEL',
            latency: Date.now() - startTime,
            tokens: 0,
            cost: 0,
            spam: false,
            abuse: false,
            score: 1.0,
            k: 0,
            model: 'N/A'
        });
        return { answer: sentinelAnswer, score: 1.0, source: 'sentinel' };
    }

    // 3. Retrieval Pipeline
    const openai = getOpenAI();
    let finalChunks: string[] = [];

    try {
        const { embedding } = await embed({ model: openai.embedding('text-embedding-3-small'), value: query });
        const primaryIntent = processRouter(query);
        
        let vectorResults: any[] = [];
        if (primaryIntent) {
            vectorResults = await qdrant.search(COLLECTION_NAME, {
                vector: embedding, limit: 10, with_payload: true,
                filter: { must: [{key: 'category', match: {value: primaryIntent}}]}
            });
        }
        
        if (vectorResults.length === 0) {
            vectorResults = await qdrant.search(COLLECTION_NAME, { vector: embedding, limit: 10, with_payload: true });
        }

        // Hybrid Scoring
        const cleanQuery = query.replace(/[^\w\s]/g, '');
        const keywords = cleanQuery.split(/\s+/).filter(w => w.length > 3);
        const resultsWithHybridScore = vectorResults.map(res => {
            const content = (res.payload?.content as string || '').toLowerCase();
            let keywordMatches = 0;
            keywords.forEach(word => { if (content.includes(word)) keywordMatches++; });
            const keywordScore = keywords.length > 0 ? keywordMatches / keywords.length : 0;
            return { ...res, hybridScore: (0.85 * res.score) + (0.15 * keywordScore) };
        });
        
        resultsWithHybridScore.sort((a, b) => b.hybridScore - a.hybridScore);
        topScore = resultsWithHybridScore[0]?.hybridScore || 0;
        
        if (topScore >= 0.25) {
            const payloadList = resultsWithHybridScore.map(r => r.payload?.content as string);
            try {
                const reranked = await cohere.rerank({ 
                    model: 'rerank-english-v3.0', 
                    query, 
                    documents: payloadList, 
                    topN: 5 
                });
                finalChunks = reranked.results.map(r => payloadList[r.index]);
            } catch(e) { 
                finalChunks = payloadList.slice(0, 5); 
            }
        }
    } catch (err) {
        console.error('Retrieval phase error:', err);
        retrievalSource = 'ERROR_FALLBACK';
    }

    kChunks = finalChunks.length;

    // 4. Generation Pipeline
    const context = finalChunks.join('\n\n---\n\n');
    let answerText = "I'm sorry, I don't have that specific information in my database right now. Could you try rephrasing?";
    
    if (kChunks > 0) {
        try {
            const { text: answer, usage } = await generateText({
                model: openai(modelId),
                system: `You are Lorin, the MSAJCE AI Concierge. Answer based ONLY on the context provided. If unsure, say you don't know. Chat history is provided for context. Answer in a friendly campus-buddy tone.`,
                prompt: `Chat History:\n${history.map(h => `${h.role}: ${h.content}`).join('\n')}\n\nContext:\n${context}\n\nUser Question: ${query}`
            });
            answerText = answer;
            tokensUsed = (usage.promptTokens || 0) + (usage.completionTokens || 0);
        } catch(err) { 
            console.error('Generation phase error:', err);
            modelId = 'ERROR'; 
        }
    }

    // 5. Final Audit Logging
    await logInteraction({
        timestamp: new Date().toISOString(),
        userId: userId.toString(),
        sessionId,
        query: rawQuery,
        answer: answerText,
        source: retrievalSource,
        latency: Date.now() - startTime,
        tokens: tokensUsed,
        cost: (tokensUsed / 1000) * 0.00015,
        spam: false,
        abuse: /(bad|worst|scam|waste)/i.test(rawQuery), 
        score: topScore,
        k: kChunks,
        model: modelId
    });

    responseCache.set(queryId, answerText);
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
