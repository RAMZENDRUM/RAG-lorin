import { generateText, embed } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { QdrantClient } from '@qdrant/js-client-rest';
import dotenv from 'dotenv';

dotenv.config();

const COLLECTION_NAME = 'lorin_knowledge';
const qdrant = new QdrantClient({
    url: process.env.QDRANT_URL,
    apiKey: process.env.QDRANT_API_KEY
});

// Bridge to OpenRouter for 1536 embeddings
const openrouter = createOpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: 'https://openrouter.ai/api/v1',
});

function getOpenAI() {
    const keys = [
        process.env.VERCEL_AI_KEY,
        process.env.VERCEL_AI_KEY_2,
        process.env.VERCEL_AI_KEY_3,
        process.env.VERCEL_AI_KEY_4
    ].filter(Boolean);
    
    // Pick a random key to distribute load
    const key = keys[Math.floor(Math.random() * keys.length)];
    
    return createOpenAI({ 
        apiKey: key,
        baseURL: 'https://ai-gateway.vercel.sh/v1'
    });
}

export interface ChatMessage { role: 'user' | 'assistant'; content: string; }
export interface RetrievalResult { answer: string; score: number; source: string; }

// --- SPEED-FOCUSED IDENTITY RESOLVER ---
async function resolveIdentityFast(query: string, history: ChatMessage[]): Promise<string> {
    const last = [...history].reverse().find(h => h.role === 'assistant')?.content.toLowerCase() || '';
    
    // Hard-coded fast-resolve for entities
    if (query.toLowerCase().includes('him') || query.toLowerCase().includes('more details')) {
        if (last.includes('srinivasan') || last.includes('principal')) return 'Dr. K. S. Srinivasan Principal bio research';
        if (last.includes('abdul gafoor') || last.includes('admin')) return 'Mr. A. Abdul Gafoor Administrative Officer';
    }
    return query;
}

export async function performLorinRetrieval(
    rawQuery: string, 
    userId: string | number, 
    sessionId: string,
    history: ChatMessage[] = []
): Promise<RetrievalResult> {
    const startTime = Date.now();
    const openai = getOpenAI();

    try {
        // 1. FAST IDENTITY LOCK
        const targetQuery = await resolveIdentityFast(rawQuery, history);
        
        // 2. VECTOR SEARCH (Single high-speed call)
        const { embedding } = await embed({ 
            model: openrouter.embedding('openai/text-embedding-3-small'), 
            value: targetQuery 
        });
        const results = await qdrant.search(COLLECTION_NAME, { vector: embedding, limit: 10, with_payload: true });

        const context = results.length > 0 
            ? results.map(r => r.payload?.content).join('\n\n') 
            : "No specific data found.";

        // 3. GENERATION
        const { text: answer } = await generateText({
            model: openai('gpt-4o-mini'),
            system: `You are Lorin, the smart MSAJCE Concierge. 
            Facts: Principal=Dr. K. S. Srinivasan. Admin=Mr. Abdul Gafoor.
            Rules: Use search context ONLY. If you find multiple people with similar names in context, LIST THEM ALL CLEARLY. 
            NEVER ask the user for more details if the answer is in the context. Just give all possible matches.
            Style: Professional, Bold Headers, Bullet points.`,
            prompt: `History Context: ${JSON.stringify(history.slice(-2))}\nSearch Context: ${context}\nQuestion: ${rawQuery}`
        });

        return { answer, score: results[0]?.score || 0, source: 'fast-rag' };

    } catch (err: any) {
        console.error('RAG Error:', err.message);
        return { answer: "I'm having a little trouble fetching those details! Try again?", score: 0, source: 'error' };
    }
}
