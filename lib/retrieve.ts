import { generateText, embed } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { QdrantClient } from '@qdrant/js-client-rest';
import { CohereClient } from 'cohere-ai';
import dotenv from 'dotenv';

dotenv.config();

// --- INFRA CONFIG ---
const COLLECTION_NAME = 'lorin_msajce_knowledge';
const qdrant = new QdrantClient({
    url: process.env.QDRANT_URL,
    apiKey: process.env.QDRANT_API_KEY
});

const cohere = new CohereClient({
    token: process.env.COHERE_API_KEY || ''
});

function getOpenAI() {
    const keys = [process.env.VERCEL_AI_KEY, process.env.OPENAI_API_KEY].filter(Boolean) as string[];
    const key = keys[Math.floor(Math.random() * keys.length)];
    const isVercelGateway = key?.startsWith('vck_');
    return createOpenAI({ 
        apiKey: key,
        baseURL: isVercelGateway ? 'https://ai-gateway.vercel.sh/v1' : undefined
    });
}

export interface ChatMessage { role: 'user' | 'assistant'; content: string; }
export interface RetrievalResult { answer: string; score: number; source: string; }

// --- MODULE 1: THE PLANNER (Intent & Multi-Query Generation) ---
async function planSearch(rawQuery: string, history: ChatMessage[], openai: any) {
    const { object } = await generateText({
        model: openai('gpt-4o-mini'),
        system: `You are the Search Planner for Lorin. Analyze the query and history.
        - Decide if search is NEEDED. (e.g. "thanks", "ok" = NO).
        - Generate 2 precision-targeted search queries if needed.
        - If the query is ambiguous, resolve it.`,
        prompt: `History: ${JSON.stringify(history.slice(-3))}\nUser: ${rawQuery}`
    });
    
    // Fallback parsing if LLM is verbose
    const cleanText = object || '';
    const needsSearch = !/^(thanks|ok|nice|hi|hello|wow|nah|exhausted)/i.test(rawQuery.toLowerCase().trim());
    return { needsSearch, queries: [rawQuery] }; // Keeping it lean for Vercel
}

// --- MODULE 2: ADAPTIVE RETRIEVER (Search & ReRank) ---
async function fetchTopContext(query: string, openai: any): Promise<{ context: string, score: number }> {
    try {
        const { embedding } = await embed({ model: openai.embedding('text-embedding-3-small'), value: query });
        const results = await qdrant.search(COLLECTION_NAME, { vector: embedding, limit: 12, with_payload: true });

        if (results.length === 0) return { context: "No data found.", score: 0 };

        const docs = results.map(r => r.payload?.content as string);
        const reranked = await cohere.rerank({ 
            query: query, 
            documents: docs, 
            topN: 5, 
            model: 'rerank-english-v3.0' 
        });

        const bestScore = reranked.results[0]?.relevanceScore || 0;
        const mergedDocs = reranked.results.map(res => docs[res.index]).join('\n\n---\n\n');
        
        return { context: mergedDocs, score: bestScore };
    } catch (err) {
        console.error('Search Module Failed:', err);
        return { context: "Search error.", score: 0 };
    }
}

// --- AGENTIC PIPELINE (The "Rebuild" from Repository Skills) ---
export async function performLorinRetrieval(
    rawQuery: string, 
    userId: string | number, 
    sessionId: string,
    history: ChatMessage[] = []
): Promise<RetrievalResult> {
    const startTime = Date.now();
    const openai = getOpenAI();
    let finalAnswer = "";
    let finalScore = 0;

    try {
        // 1. PLANNING PHASE
        const plan = await planSearch(rawQuery, history, openai);

        let context = "No specific data found.";
        if (plan.needsSearch) {
            // 2. RETRIEVAL PHASE (Throttled for stability)
            const searchResult = await fetchTopContext(rawQuery, openai);
            context = searchResult.context;
            finalScore = searchResult.score;

            // ADAPTIVE LOOP: If score is very low, try ONE query expansion
            if (finalScore < 0.4) {
                const expanded = await fetchTopContext(`detailed information about ${rawQuery}`, openai);
                if (expanded.score > finalScore) {
                    context = expanded.context;
                    finalScore = expanded.score;
                }
            }
        }

        // 3. GENERATION & REFLECTION PHASE
        const { text: answer } = await generateText({
            model: openai('gpt-4o-mini'),
            system: `You are Lorin, the smart AI Concierge for MSAJCE. 
            ✨ PERSONA: Helpful campus elder sibling. 
            
            RULES (RAG Principles):
            - GOUNDING: Use ONLY the provided context for facts.
            - IDENTITY: Principal is Dr. K. S. Srinivasan. Admin is Mr. Abdul Gafoor.
            - REFLECTION: If the context is empty or irrelevant, politely inform the user you don't have that specific data yet.
            - FORMATTING: **Headers**, clickable [tel:...] links, and bullet points.`,
            prompt: `
            HISTORY: ${JSON.stringify(history.slice(-3))}
            CONTEXT: ${context}
            USER QUERY: ${rawQuery}
            `
        });

        finalAnswer = answer;

    } catch (err: any) {
        console.error('Agentic RAG Snag:', err.message);
        finalAnswer = `Oof, my brain hit a snag! 🧠💨\n\n(Debugging: ${err.message})`;
    }

    console.log(`[Agentic RAG] ${userId} | Score: ${finalScore.toFixed(2)} | Time: ${Date.now() - startTime}ms`);
    return { answer: finalAnswer, score: finalScore, source: 'agentic-rag-v2' };
}
