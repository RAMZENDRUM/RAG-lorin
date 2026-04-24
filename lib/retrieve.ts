import { generateText, embed } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { QdrantClient } from '@qdrant/js-client-rest';
import { CohereClient } from 'cohere-ai';
import dotenv from 'dotenv';

dotenv.config();

// --- CONFIG & INFRA ---
const COLLECTION_NAME = 'lorin_msajce_knowledge';
const qdrant = new QdrantClient({
    url: process.env.QDRANT_URL,
    apiKey: process.env.QDRANT_API_KEY
});

const cohere = new CohereClient({
    token: process.env.COHERE_API_KEY || ''
});

const responseCache = new Map<string, any>(); // Simplified In-Memory Cache

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
    // Universal Context Clean: Remove duplicate headers and whitespace
    const unique = Array.from(new Set(chunks));
    return unique.join('\n\n---\n\n').replace(/\n{3,}/g, '\n\n');
}

// --- ELITE RAG PIPELINE ---
export interface ChatMessage { role: 'user' | 'assistant'; content: string; }
export interface RetrievalResult { answer: string; score: number; source: string; }

export async function performLorinRetrieval(
    rawQuery: string, 
    userId: string | number, 
    sessionId: string,
    history: ChatMessage[] = []
): Promise<RetrievalResult> {
    const startTime = Date.now();
    const cacheKey = `${userId}:${rawQuery.toLowerCase().trim()}`;
    if (responseCache.has(cacheKey)) return responseCache.get(cacheKey);

    try {
        const openai = getOpenAI();

        // 1. QUERY NORMALIZATION & CONTEXTUALIZATION
        const { text: processedQuery } = await generateText({
            model: openai('gpt-4o-mini'),
            system: "Normalize and Contextualize: Resolve pronouns/follow-ups into standalone search queries using history. ONLY return the query.",
            prompt: `History: ${JSON.stringify(history.slice(-3))}\nQuery: ${rawQuery}`
        });

        // 2. ROUTER (Intent + Entity Detection)
        const { text: intentJson } = await generateText({
            model: openai('gpt-4o-mini'),
            system: "Router: Output JSON { intent: string, entity: string, priority: boolean }. Intents: STAFF, ADMISSION, FACILITY, SMALLTALK.",
            prompt: `Query: ${processedQuery}`
        });
        const routing = JSON.parse(intentJson.replace(/```json|```/g, ''));

        // 3. EXACT MATCH CHECK (Sentinel Override)
        if (routing.intent === 'STAFF') {
            const lowQ = processedQuery.toLowerCase();
            if (lowQ.includes('principal') || lowQ.includes('srinivasan')) {
                return { answer: `🎓 **Dr. K. S. Srinivasan (Principal)**\n\nVisionary academician specializing in **Optical Fiber Monitoring (Patent 202241071306)**. \n\n📞 [tel:9150575066] | 📧 [mailto:principal@msajce-edu.in]\n\nWould you like his research bio or contact details? ✨`, score: 1.0, source: 'exact-match' };
            }
            if (lowQ.includes('abdul gafoor')) {
                return { answer: `💼 **Mr. A. Abdul Gafoor (Admin Officer)**\n\nAssistant Transport Convener. Handles all administrative inquiries and bus routes. \n\n📞 [tel:9940319629] | 📧 [mailto:abdulgafoor@msajce-edu.in]\n\nDo you need to ask about a specific bus route? 🚌`, score: 1.0, source: 'exact-match' };
            }
        }

        // 4. FILTERED RETRIEVAL (Qdrant)
        const { embedding } = await embed({ model: openai.embedding('text-embedding-3-small'), value: processedQuery });
        const results = await qdrant.search(COLLECTION_NAME, { vector: embedding, limit: 12, with_payload: true });

        // 5. RERANK (Cohere)
        let finalContext = "No specific data found.";
        let finalScore = 0;

        if (results.length > 0) {
            const documents = results.map(r => r.payload?.content as string);
            const reranked = await cohere.rerank({ query: processedQuery, documents: documents, topN: 5, model: 'rerank-english-v2.0' });
            
            // 6. CHUNK MERGE & CONTEXT CLEAN
            finalContext = cleanContext(reranked.results.map(res => documents[res.index]));
            finalScore = reranked.results[0].relevanceScore;
        }

        // 7. ANSWER GENERATION (Strict Adherence)
        const { text: answer } = await generateText({
            model: openai('gpt-4o-mini'),
            system: `You are Lorin, the smart AI Concierge for MSAJCE. 
            STRICT RULES:
            - EXACT PRESERVATION: Do not hallucinate. Use verified context.
            - SUBJECT LOCK: "Him/Her" refers to the person in the search result or last history.
            - FORMATTING: **Headers**, Bullet points, Clickable Links.
            - Smalltalk: If Smalltalk is detected, be friendly but nudge back to college topics.`,
            prompt: `Context:\n${finalContext}\n\nHistory:\n${JSON.stringify(history.slice(-3))}\n\nUser: ${rawQuery}`
        });

        const result = { answer, score: finalScore, source: 'reranked-rag' };
        
        // 8. CACHE + LOG
        responseCache.set(cacheKey, result);
        console.log(`[ELITE RAG] ${userId} | ${routing.intent} | Score:${finalScore.toFixed(2)}`);
        
        return result;

    } catch (err: any) {
        console.error('Elite RAG Pipeline Failure:', err);
        return { answer: "My brain hit a snag! 🧠 Trying to reconnect...", score: 0, source: 'error' };
    }
}
