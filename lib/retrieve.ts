import { generateText, embed } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { QdrantClient } from '@qdrant/js-client-rest';
import { CohereClient } from 'cohere-ai';
import dotenv from 'dotenv';

dotenv.config();

// --- CONFIG ---
const COLLECTION_NAME = 'lorin_msajce_knowledge';
const qdrant = new QdrantClient({
    url: process.env.QDRANT_URL,
    apiKey: process.env.QDRANT_API_KEY
});

const cohere = new CohereClient({
    token: process.env.COHERE_API_KEY || ''
});

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
    
    if (keys.length === 0) throw new Error('No API Keys found!');
    const key = keys[Math.floor(Math.random() * keys.length)];
    const isVercelGateway = key.startsWith('vck_');
    
    return createOpenAI({ 
        apiKey: key,
        baseURL: isVercelGateway ? 'https://ai-gateway.vercel.sh/v1' : undefined
    });
}

export interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
}

export interface RetrievalResult {
    answer: string;
    score: number;
    source: string;
}

// --- UNIVERSAL RAG ENGINE ---
export async function performLorinRetrieval(
    rawQuery: string, 
    userId: string | number, 
    sessionId: string,
    history: ChatMessage[] = []
): Promise<RetrievalResult> {
    const startTime = Date.now();
    let finalAnswer = "I'm having a little trouble connecting to my brain! 🧠💨";
    let topScore = 0;
    
    try {
        const openai = getOpenAI();

        // 1. RECURSIVE CONTEXTUALIZATION
        let processedQuery = normalizeQuery(rawQuery);
        if (history.length > 0) {
            const { text } = await generateText({
                model: openai('gpt-4o-mini'),
                system: `You are a Search Contextualizer. 
                Resolve pronouns ("him", "her") and confirmation words ("yes", "more") using chat history. 
                Turn them into specific search queries. ONLY output the rewritten query.`,
                prompt: `History:\n${history.map(h => `${h.role}: ${h.content}`).join('\n')}\n\nLast Query: ${rawQuery}`
            });
            processedQuery = text.trim();
        }

        // 2. VECTOR RETRIEVAL
        const { embedding } = await embed({ 
            model: openai.embedding('text-embedding-3-small'), 
            value: processedQuery 
        });
        
        const searchResults = await qdrant.search(COLLECTION_NAME, { 
            vector: embedding, 
            limit: 10,
            with_payload: true 
        });

        // 3. COHERE RE-RANKING
        let context = "No specific data found.";
        if (searchResults.length > 0) {
            const documents = searchResults.map(r => r.payload?.content as string);
            try {
                const reranked = await cohere.rerank({
                    query: processedQuery,
                    documents: documents,
                    topN: 5,
                    model: 'rerank-english-v2.0'
                });
                context = reranked.results.map(res => documents[res.index]).join('\n\n---\n\n');
                topScore = reranked.results[0].relevanceScore;
            } catch (rrErr) {
                context = documents.slice(0, 5).join('\n\n---\n\n');
                topScore = searchResults[0].score;
            }
        }

        // 4. PERSONA-DRIVEN GENERATION (With Staff Priming)
        const { text: answer } = await generateText({
            model: openai('gpt-4o-mini'),
            system: `You are Lorin, the smart AI Concierge for MSAJCE Engineering College. ✨
            
            STAFF IDENTITIES (PRIORITY):
            - DR. K. S. SRINIVASAN (Principal): Visionary leader. Research in optical cables (Patent 202241071306). Connections to IIT Madras & NIT Trichy. Handles student welfare.
            - MR. A. ABDUL GAFOOR (Admin Officer): Assistant Transport Convener. Handles admin inquiries and bus routes. 
            - RAMANATHAN S (Ram): The AI Developer. 2nd year IT student. Only discuss if specifically named.
            
            RULES:
            1. SUBJECT LOCK: If the last message was about the Principal, "him" = Principal. If last was Abdul Gafoor, "him" = Gafoor.
            2. NEVER cross-contaminate identities. 
            3. Use **Bold Headers**, bullet points (•), and clickable [tel:...] or [mailto:...] links.
            4. If search data is missing but you have the identity above, USE THE IDENTITY.`,
            prompt: `
            CHAT HISTORY:
            ${history.map(h => `${h.role}: ${h.content}`).join('\n')}
            
            SEARCH DATA:
            ${context}
            
            USER MESSAGE:
            ${rawQuery}
            `
        });

        finalAnswer = answer;

    } catch (err: any) {
        console.error('Universal RAG Error:', err);
        finalAnswer = `Oof, my brain hit a snag! 🧠💨`;
    }

    return { answer: finalAnswer, score: topScore, source: 'unified-rag' };
}
