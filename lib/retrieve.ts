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

// --- ELITE IDENTITY RESOLVER (From RAG Techniques) ---
async function resolveIdentity(query: string, history: ChatMessage[], openai: any): Promise<string> {
    const lastContext = history.map(h => h.content).join(' ').toLowerCase();
    
    // Hard-coded Entity Resolution to prevent hijacking
    if (query.toLowerCase().includes('him') || query.toLowerCase().includes('more details')) {
        if (lastContext.includes('srinivasan') || lastContext.includes('principal')) return `Dr. K. S. Srinivasan Principal`;
        if (lastContext.includes('abdul gafoor') || lastContext.includes('admin officer')) return `Mr. A. Abdul Gafoor Administrative Officer`;
    }
    
    const { text } = await generateText({
        model: openai('gpt-4o-mini'),
        system: "You are a Research Assistant. If the user uses pronouns or asks for 'more details', rewrite the query to include the EXACT NAME of the subject from history. ONLY output the rewritten query.",
        prompt: `History:\n${JSON.stringify(history.slice(-3))}\n\nQuery: ${query}`
    });
    return text.trim();
}

// --- UNIVERSAL AGENTIC ENGINE ---
export async function performLorinRetrieval(
    rawQuery: string, 
    userId: string | number, 
    sessionId: string,
    history: ChatMessage[] = []
): Promise<RetrievalResult> {
    const startTime = Date.now();
    const openai = getOpenAI();

    try {
        // 1. RESOLVE SUBJECT (Entity Locking)
        const searchTarget = await resolveIdentity(rawQuery, history, openai);
        
        // 2. MULTI-VECTOR RETRIEVAL
        const { embedding } = await embed({ model: openai.embedding('text-embedding-3-small'), value: searchTarget });
        const results = await qdrant.search(COLLECTION_NAME, { vector: embedding, limit: 12, with_payload: true });

        // 3. COHERE RE-RANKING & IDENTITY GUARDRAIL
        let finalContext = "No specific data found.";
        let finalScore = 0;

        if (results.length > 0) {
            const documents = results.map(r => r.payload?.content as string);
            const reranked = await cohere.rerank({ 
                query: searchTarget, 
                documents: documents, 
                topN: 5, 
                model: 'rerank-english-v3.0' 
            });
            
            // ELITE GUARDRAIL: If we are looking for Staff but Reranker found a Student (Developer), Discard!
            const bestDoc = documents[reranked.results[0].index];
            if (searchTarget.includes('Principal') && bestDoc.includes('B.Tech') && !bestDoc.includes('Srinivasan')) {
                finalContext = "No deeper research data found for Dr. Srinivasan in the database currently.";
            } else {
                finalContext = reranked.results.map(res => documents[res.index]).join('\n\n---\n\n');
                finalScore = reranked.results[0].relevanceScore;
            }
        }

        // 4. GENERATION WITH STATIC IDENTITY GROUNDING
        const { text: answer } = await generateText({
            model: openai('gpt-4o-mini'),
            system: `You are Lorin, the smart AI Concierge for MSAJCE. ✨
            
            IMMUTABLE IDENTITIES:
            - Principal: Dr. K. S. Srinivasan. (Handled research with optics, NIT Trichy alumni).
            - Admin: Mr. A. Abdul Gafoor (Transport expert).
            - Developer: Ramanathan S (IT Student).
            
            STRICT RULES:
            - If "him" refers to the Principal in history, DO NOT talk about Ramanathan.
            - If data for the Principal is limited, say "I have provided the available contact and research details for Dr. Srinivasan." 
            - FORMATTING: **Bold Headers**, bullet points, and clickable links.`,
            prompt: `History:\n${JSON.stringify(history.slice(-3))}\n\nSearch context:\n${finalContext}\n\nUser Question: ${rawQuery}`
        });

        return { answer, score: finalScore, source: 'agentic-v3-resolved' };

    } catch (err: any) {
        console.error('Agentic Snag:', err);
        return { answer: "My brain hit a snag! 🧠💨", score: 0, source: 'error' };
    }
}
