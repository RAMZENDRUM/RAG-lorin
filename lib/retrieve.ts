import crypto from 'crypto';
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
    
    if (keys.length === 0) throw new Error('No API Keys found (OpenAI or Vercel Gateway)!');
    
    const key = keys[Math.floor(Math.random() * keys.length)];
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

        // 1. Contextualize Query (Convert "yes", "more", "him" into specific subjects)
        if (history.length > 0) {
            try {
                const { text } = await generateText({
                    model: openai('gpt-4o-mini'),
                    system: `You are a Search Contextualizer. 
                    IDENTITY RULES:
                    - "Principal" or "Srinivasan" = Dr. K. S. Srinivasan (The Boss).
                    - "Developer", "Ram", or "Ramanathan" = The AI engine developer.
                    - "Him" or "He" MUST resolve to the person most recently discussed in history.
                    If the user says 'yes' or 'more', rewrite to ask for specific background or research based on the last topic.`,
                    prompt: `History:\n${history.map(h => `${h.role}: ${h.content}`).join('\n')}\n\nLatest Message: ${rawQuery}`
                });
                contextualizedQuery = text.trim();
            } catch (e) {
                console.error('Rewriting failed');
            }
        }

        // 2. Identify Intent & Sentinels
        const lowerQuery = contextualizedQuery.toLowerCase();
        const rawLower = rawQuery.toLowerCase();
        const lastMsg = history[history.length - 1]?.content.toLowerCase() || '';
        
        // HARD SENTINEL: Principal Contact Info
        if ((rawLower.includes('principal') || rawLower.includes('srinivasan')) && !rawLower.includes('research') && !rawLower.includes('initiative') && !rawLower.includes('more')) {
            return { 
                answer: `🎓 **Meet Our Principal**\n\n**Dr. K. S. Srinivasan** is the visionary leader of MSAJCE!\n\n📞 **Contact Details:**\n• **Phone:** [+91 91505 75066](tel:+919150575066)\n• **Email:** [principal@msajce-edu.in](mailto:principal@msajce-edu.in)\n\n---\nWould you like to know about his **research background** or **current initiatives**? ✨`, 
                score: 1.0, 
                source: 'sentinel' 
            };
        }

        // HARD SENTINEL: Abdul Gafoor (Administrative Officer)
        if (rawLower.includes('abdul gafoor') || (rawLower.includes('admin') && rawLower.includes('officer'))) {
            return {
                answer: `💼 **Administrative Office**\n\n**Mr. A. Abdul Gafoor** is the **Administrative Officer** (AO) and the **Assistant Transport Convener** at MSAJCE. He is your main point of contact for administrative inquiries and bus routes!\n\n📞 **Contact Details:**\n• **Phone:** [+91 99403 19629](tel:+919940319629)\n• **Email:** [abdulgafoor@msajce-edu.in](mailto:abdulgafoor@msajce-edu.in)\n\n---\nDo you have questions about a specific **bus route** or **administrative paperwork**? 🚌`,
                score: 1.0,
                source: 'sentinel'
            };
        }

        // HARD SENTINEL: Research/Bio/Bus Routes confirmation
        const isConfirmation = /^(yes|yeah|yep|sure|ok|tell me more|more|show me|initiatives|research|bus|route)/i.test(rawLower);
        
        if (isConfirmation) {
            // Case 1: Following up on Principal
            if (lastMsg.includes('principal') || lastMsg.includes('srinivasan')) {
                return {
                    answer: `🔬 **Dr. K. S. Srinivasan's Expertise**\n\nOur Principal is a highly respected academic with connections across **IIT Madras**, **NIT Trichy**, and **TNSCST**. \n\n**Key Initiatives:**\n• **Innovation:** Established key metrics to monitor student entrepreneurship.\n• **Research:** Oversees all institutional research committees and student welfare projects.\n• **Vision:** Focuses on fostering self-employment and modern engineering practices.\n\nIs there a specific research area or student project you'd like to dive into? 🚀`,
                    score: 1.0,
                    source: 'sentinel'
                };
            }
            // Case 2: Following up on Admin/Transport
            if (lastMsg.includes('abdul gafoor') || lastMsg.includes('transport') || lastMsg.includes('bus')) {
                return {
                    answer: `🚌 **MSAJCE Transport Services**\n\nWe have a fleet of **22 buses** covering Chennai, Chengalpattu, Kanchipuram, and Thiruvallur!\n\n**Key Info:**\n• **Fleet:** 22 Buses, 1 Tata ACE, and 1 Ambulance.\n• **Committe:** Led by Dr. K.P. Santhosh Nathan (Convener) and Mr. A. Abdul Gafoor (Asst. Convener).\n• **Routes:** Covers all major transit points like Chennai Central, Tambaram, and CMDA station.\n\nWould you like the **specific route timings** (AR3-AR10) for your area? 📍`,
                    score: 1.0,
                    source: 'sentinel'
                };
            }
        }

        const isSmallTalk = history.length > 0 && /^(nice|thanks|cool|ok|wow|hello|hi|great|that|nah)/i.test(rawLower) && rawLower.length < 10 && !isConfirmation;

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
                
                CRITICAL IDENTITY RULES:
                1. DR. SRINIVASAN: The Principal. If asked about "Him" after discussing Principal, talk about the Principal.
                2. RAMANATHAN / RAM: The Developer of this AI. Only talk about him if specifically named. NEVER refer to him as "The Principal".
                3. NEVER mix Dr. Srinivasan and Ram. They are different people.
                
                STYLE:
                - Use **Bold Headers** and bullet points.
                - Format phone numbers as links.
                - Stay warm and interactive.`,
                prompt: `History:\n${history.map(h => `${h.role}: ${h.content}`).join('\n')}\n\nContext:\n${context}\n\nUser Message: ${rawQuery}`
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
