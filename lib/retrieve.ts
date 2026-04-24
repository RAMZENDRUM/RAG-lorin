import { generateText, embed } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { QdrantClient } from '@qdrant/js-client-rest';
import dotenv from 'dotenv';

dotenv.config();

const COLLECTION_NAME = 'lorin_msajce_knowledge';
const qdrant = new QdrantClient({
    url: process.env.QDRANT_URL,
    apiKey: process.env.QDRANT_API_KEY
});

function getOpenAI() {
    const key = process.env.VERCEL_AI_KEY || process.env.OPENAI_API_KEY;
    const isVercelGateway = key?.startsWith('vck_');
    return createOpenAI({ 
        apiKey: key,
        baseURL: isVercelGateway ? 'https://ai-gateway.vercel.sh/v1' : undefined
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
        const { embedding } = await embed({ model: openai.embedding('text-embedding-3-small'), value: targetQuery });
        const results = await qdrant.search(COLLECTION_NAME, { vector: embedding, limit: 6, with_payload: true });

        const context = results.length > 0 
            ? results.map(r => r.payload?.content).join('\n\n') 
            : "No specific data found.";

        // 3. GENERATION
        const { text: answer } = await generateText({
            model: openai('gpt-4o-mini'),
            system: `You are Lorin, the smart MSAJCE Concierge. 
            Facts: Principal=Dr. K. S. Srinivasan. Admin=Mr. Abdul Gafoor.
            Rules: Use context. If "him" refers to someone in history, stay on that subject. 
            Style: Bold Headers, Bullet points.`,
            prompt: `History Context: ${JSON.stringify(history.slice(-2))}\nSearch Context: ${context}\nQuestion: ${rawQuery}`
        });

        return { answer, score: results[0]?.score || 0, source: 'fast-rag' };

    } catch (err: any) {
        console.error('RAG Error:', err.message);
        return { answer: "I'm having a little trouble fetching those details! Try again?", score: 0, source: 'error' };
    }
}
