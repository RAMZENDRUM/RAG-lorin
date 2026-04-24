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

        // 1. RECURSIVE CONTEXTUALIZATION (Universal Subject Locking)
        let processedQuery = normalizeQuery(rawQuery);
        if (history.length > 0) {
            const { text } = await generateText({
                model: openai('gpt-4o-mini'),
                system: `You are a Search Contextualizer. Given a chat history and a latest query, rewrite the query to be a standalone search term. 
                - If the user uses "him", "her", "they", "it", resolve the pronoun using history.
                - If the user says "yes", "more", "tell me", "sure", rewrite it to ask for more details about the LAST topic discussed.
                - If the query is already clear, do not change it much.
                - ONLY output the rewritten query.`,
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
            limit: 15, // Get more for re-ranking
            with_payload: true 
        });

        // 3. COHERE RE-RANKING (Universal Accuracy)
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
                
                context = reranked.results
                    .map(res => documents[res.index])
                    .join('\n\n---\n\n');
                
                topScore = reranked.results[0].relevanceScore;
            } catch (rrErr) {
                console.error('ReRank failed, falling back to vector score');
                context = documents.slice(0, 5).join('\n\n---\n\n');
                topScore = searchResults[0].score;
            }
        }

        // 4. PERSONA-DRIVEN GENERATION
        const isSmallTalk = history.length > 0 && /^(nice|thanks|cool|ok|wow|hello|hi|great|that|nah)/i.test(normalizeQuery(rawQuery)) && rawQuery.length < 10;

        const { text: answer } = await generateText({
            model: openai('gpt-4o-mini'),
            system: `You are Lorin, the smart AI Concierge for MSAJCE Engineering College. 
            
            CORE DIRECTIVES:
            - IDENTITY: The Principal is Dr. K. S. Srinivasan. The Developer is Ramanathan S (Ram). 
            - MEMORY: Use chat history to stay on topic. If search context is empty but history has the info, USE HISTORY.
            - ACCURACY: Only state facts from the context. If not found, say you don't have that specific detail yet.
            - FORMATTING: Use **Bold Headers**, bullet points (•), and clickable [tel:...] or [mailto:...] links.
            - TONE: Friendly campus senior. ✨
            
            If the context provided is "No specific data found", use your history and general knowledge of being a campus concierge to guide the user back to valid topics.`,
            prompt: `
            CHAT HISTORY:
            ${history.map(h => `${h.role}: ${h.content}`).join('\n')}
            
            SEARCH CONTEXT (Verified Data):
            ${context}
            
            USER'S LATEST MESSAGE:
            ${rawQuery}
            `
        });

        finalAnswer = answer;

    } catch (err: any) {
        console.error('Universal RAG Error:', err);
        finalAnswer = `Oof, my brain hit a snag! 🧠💥\n\nError: \`${err.message}\``;
    }

    console.log(`[Universal RAG] Query: ${rawQuery} | Latency: ${Date.now() - startTime}ms | Score: ${topScore.toFixed(3)}`);
    return { answer: finalAnswer, score: topScore, source: 'reranked-rag' };
}
