import { generateText, embed } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { QdrantClient } from '@qdrant/js-client-rest';
import { CohereClient } from 'cohere-ai';
import dotenv from 'dotenv';

dotenv.config();

// --- INFRA ---
const COLLECTION_NAME = 'lorin_msajce_knowledge';
const qdrant = new QdrantClient({
    url: process.env.QDRANT_URL,
    apiKey: process.env.QDRANT_API_KEY
});

const cohere = new CohereClient({
    token: process.env.COHERE_API_KEY || ''
});

const responseCache = new Map<string, any>();

function getOpenAI() {
    const keys = [process.env.VERCEL_AI_KEY, process.env.OPENAI_API_KEY].filter(Boolean) as string[];
    const key = keys[Math.floor(Math.random() * keys.length)];
    const isVercelGateway = key?.startsWith('vck_');
    return createOpenAI({ 
        apiKey: key,
        baseURL: isVercelGateway ? 'https://ai-gateway.vercel.sh/v1' : undefined
    });
}

// --- CORE UTILS ---
function cleanContext(chunks: string[]): string {
    const unique = Array.from(new Set(chunks));
    return unique.join('\n\n---\n\n').replace(/\n{3,}/g, '\n\n');
}

export interface ChatMessage { role: 'user' | 'assistant'; content: string; }
export interface RetrievalResult { answer: string; score: number; source: string; }

// --- ADVANCED RAG ENGINE (Inspired by Karpathy/LangChain/NirDiamant) ---
export async function performLorinRetrieval(
    rawQuery: string, 
    userId: string | number, 
    sessionId: string,
    history: ChatMessage[] = []
): Promise<RetrievalResult> {
    const startTime = Date.now();
    const openai = getOpenAI();

    try {
        // 1. MULTI-QUERY EXPANSION (Skill: RAG-Fusion)
        const { text: queryVariants } = await generateText({
            model: openai('gpt-4o-mini'),
            system: "You are a Query Expander. Generate 3 diverse variations of the query to capture different search angles. Separate by newlines. ONLY output queries.",
            prompt: `Last 3 Message Context: ${JSON.stringify(history.slice(-3))}\nQuery: ${rawQuery}`
        });
        const queries = [rawQuery, ...queryVariants.split('\n').filter(q => q.length > 5)].slice(0, 4);

        // 2. PARALLEL VECTOR RETRIEVAL
        const allPoints = await Promise.all(queries.map(async (q) => {
            const { embedding } = await embed({ model: openai.embedding('text-embedding-3-small'), value: q });
            return qdrant.search(COLLECTION_NAME, { vector: embedding, limit: 10, with_payload: true });
        }));

        // Flatten and unique-ify results
        const uniqueResults = new Map();
        allPoints.flat().forEach(p => uniqueResults.set(p.id, p));
        const mergedResults = Array.from(uniqueResults.values());

        // 3. COHERE RERANK & SELF-CORRECTION GRADING
        let finalContext = "No specific data found.";
        let finalScore = 0;

        if (mergedResults.length > 0) {
            const documents = mergedResults.map(r => r.payload?.content as string);
            const reranked = await cohere.rerank({ 
                query: rawQuery, 
                documents: documents, 
                topN: 6, 
                model: 'rerank-english-v3.0' 
            });
            
            finalContext = cleanContext(reranked.results.map(res => documents[res.index]));
            finalScore = reranked.results[0].relevanceScore;
        }

        // 4. PERSONA-DRIVEN GENERATION (With Guardrails)
        const { text: answer } = await generateText({
            model: openai('gpt-4o-mini'),
            system: `You are Lorin, the smart AI Concierge for MSAJCE. ✨
            
            IDENTITY PRIMING:
            - Principal: Dr. K. S. Srinivasan (Optic Fiber Expert).
            - Admin Officer: Mr. A. Abdul Gafoor (Transport Convener).
            - Developer: Ramanathan S (IT Student). Only talk about him if specifically named.
            
            ADHERENCE RULES:
            - If data is in SEARCH CONTEXT, use it exactly.
            - If "him/her" is used, resolve to the most recent subject in history.
            - Format phone numbers as links. Use Bold Headers.`,
            prompt: `History:\n${JSON.stringify(history.slice(-3))}\n\nSearch Context:\n${finalContext}\n\nUser: ${rawQuery}`
        });

        return { answer, score: finalScore, source: 'fusion-rag' };

    } catch (err: any) {
        console.error('Advanced RAG Failure:', err);
        return { answer: "My brain hit a snag! 🧠💨", score: 0, source: 'error' };
    }
}
