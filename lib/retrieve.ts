import crypto from 'crypto';
import { generateText, embed } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { QdrantClient } from '@qdrant/js-client-rest';
import { CohereClient } from 'cohere-ai';
import dotenv from 'dotenv';

dotenv.config();

// --- CONFIG ---
const COLLECTION_NAME = 'lorin_rag_core';
const qdrant = new QdrantClient({
    url: process.env.QDRANT_URL,
    apiKey: process.env.QDRANT_API_KEY
});

const cohere = new CohereClient({
    token: process.env.COHERE_API_KEY || ''
});

const responseCache = new Map<string, string>();

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
    
    if (keys.length === 0) throw new Error('No API Keys found (OpenAI or Vercel Gateway)!');
    
    const key = keys[Math.floor(Math.random() * keys.length)];
    
    // Auto-detect Vercel Gateway Key vs Standard OpenAI Key
    const isVercelGateway = key.startsWith('vck_');
    
    return createOpenAI({ 
        apiKey: key,
        baseURL: isVercelGateway ? 'https://ai-gateway.vercel.sh/v1' : undefined
    });
}

// --- CORE PIPELINE ---
export interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
}

export interface RetrievalResult {
    answer: string;
    score: number;
    source: string;
}

export async function performLorinRetrieval(
    rawQuery: string, 
    userId: string | number, 
    sessionId: string,
    history: ChatMessage[] = []
): Promise<RetrievalResult> {
    const startTime = Date.now();
    let tokensUsed = 0;
    let finalAnswer = "I'm having a little trouble connecting to my brain right now! 🧠💨 Could you ask me again in a second?";
    let topScore = 0;
    let contextualizedQuery = normalizeQuery(rawQuery);

    try {
        const openai = getOpenAI();

        // 1. Contextualize Query (Convert "yes", "more", "tell me" into full searches)
        if (history.length > 0) {
            try {
                const { text } = await generateText({
                    model: openai('gpt-4o-mini'),
                    system: "You are a Search Contextualizer. You see the chat history. If the user's latest message is a confirmation (like 'yes', 'sure', 'more', 'tell me'), rewrite it as a specific search query based on the assistant's previous suggestion or the main subject. ONLY output the rewritten query. DO NOT prefix it.",
                    prompt: `History:\n${history.map(h => `${h.role}: ${h.content}`).join('\n')}\n\nUser: ${rawQuery}`
                });
                contextualizedQuery = text.trim();
            } catch (e) {
                console.error('Rewriting failed');
            }
        }

        // 2. Identify Intent & Sentinels
        const lowerQuery = contextualizedQuery.toLowerCase();
        const rawLower = rawQuery.toLowerCase();
        
        // HARD SENTINEL: Only trigger if the user asks for the principal specifically, 
        // NOT if they are asking about research/initiatives (let the AI handle those).
        if ((rawLower.includes('principal') || rawLower.includes('srinivasan')) && !rawLower.includes('research') && !rawLower.includes('initiative')) {
            return { 
                answer: `🎓 **Meet Our Principal**\n\n**Dr. K. S. Srinivasan** is the visionary leader of MSAJCE, dedicated to academic excellence and student success!\n\n📞 **Contact Details:**\n• **Phone:** [+91 91505 75066](tel:+919150575066)\n• **Email:** [principal@msajce-edu.in](mailto:principal@msajce-edu.in)\n\n---\nWould you like to know about his **research background** or **current initiatives**? ✨`, 
                score: 1.0, 
                source: 'sentinel' 
            };
        }

        const isSmallTalk = history.length > 0 && /^(nice|thanks|cool|ok|wow|hello|hi|great|that|yep|yes|sure)/i.test(rawLower) && rawLower.length < 10;

        // 3. Search
        let context = "No specific data found.";
        if (!isSmallTalk) {
            try {
                const { embedding } = await embed({ 
                    model: openai.embedding('text-embedding-3-small'), 
                    value: contextualizedQuery 
                });
                
                const results = await qdrant.search(COLLECTION_NAME, { 
                    vector: embedding, 
                    limit: 5, 
                    with_payload: true 
                });

                if (results.length > 0) {
                    topScore = results[0].score;
                    context = results.map(r => r.payload?.content as string).join('\n\n---\n\n');
                }
            } catch (err) {
                console.error('Search error:', err);
            }
        }

        // 4. Generate
        try {
            const { text, usage } = await generateText({
                model: openai('gpt-4o-mini'),
                system: `You are Lorin, the smart AI Concierge for MSAJCE Engineering College. 
                
                STYLE GUIDELINES:
                1. STRUCTURE: Use **Bold Headers**, bullet points (•), and line breaks. Avoid long paragraphs.
                2. CONTACTS: Format phone numbers as clickable markdown links.
                3. INTERACTION: Always end with a short follow-up question.
                4. PERSONA: You are a helpful campus senior. Use emojis naturally.`,
                prompt: `Context:\n${context}\n\nHistory:\n${history.map(h => `${h.role}: ${h.content}`).join('\n')}\n\nUser Question: ${rawQuery}`
            });
            finalAnswer = text;
            tokensUsed = (usage.promptTokens || 0) + (usage.completionTokens || 0);
        } catch (err: any) {
            console.error('Generation error:', err);
            finalAnswer = `Ooh, I see what you're asking, but I'm having a hard time reaching my brain! 😅\n\nError: \`${err.message}\`\n\nCan I help with anything else?`;
        }
    } catch (rootErr: any) {
        console.error('Root Retrieval Error:', rootErr);
        finalAnswer = `⚠️ **Configuration Error**\n\nI couldn't find my AI API keys! Please make sure 'OPENAI_API_KEY' is added to Vercel.\n\nError: \`${rootErr.message}\``;
    }

    // 5. Final Diagnostic Log
    console.log(`[Lorin] User:${userId} | Latency:${Date.now() - startTime}ms | Score:${topScore.toFixed(3)} | Query:${contextualizedQuery}`);

    return { answer: finalAnswer, score: topScore, source: 'live' };
}
