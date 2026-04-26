import { embed, generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { QdrantClient } from '@qdrant/js-client-rest';
import dotenv from 'dotenv';
import type { ShortTermMemory, UserProfile } from './memory.js';
export { fetchMemory, updateProfile, extractInterest } from './memory.js';

dotenv.config();

// ─────────────────────────────────────────────
// AI CONFIGURATION (Sequential Rotation)
// ─────────────────────────────────────────────
export function getDynamicAIClient(attempt: number = 0) {
    const keys = [
        process.env.OPENAI_API_KEY, 
        process.env.VERCEL_AI_KEY,
        process.env.VERCEL_AI_KEY_2,
        process.env.VERCEL_AI_KEY_3,
        process.env.VERCEL_AI_KEY_4
    ].filter(Boolean);
    
    const key = keys[attempt % keys.length];
    const isVercelKey = key?.startsWith('vck_');
    
    return createOpenAI({ 
        apiKey: key,
        baseURL: isVercelKey ? "https://ai-gateway.vercel.sh/v1" : 'https://api.openai.com/v1'
    });
}

async function callAIWithRotation(fn: (openai: any) => Promise<any>, maxRetries: number = 3) {
    for (let i = 0; i <= maxRetries; i++) {
        const openai = getDynamicAIClient(i);
        try {
            return await fn(openai);
        } catch (error: any) {
            const isRateLimit = error.statusCode === 429 || error.message?.includes('rate limit') || error.message?.includes('abus');
            if (isRateLimit && i < maxRetries) {
                console.warn(`⚠️ Key Rotation Stage ${i}: Redirecting traffic...`);
                continue;
            }
            throw error;
        }
    }
}

// ─────────────────────────────────────────────
// TYPES & CONSTANTS
// ─────────────────────────────────────────────
export type Intent = 'admission' | 'faculty' | 'department' | 'hostel' | 'transport' | 'fee' | 'placement' | 'complaint' | 'general';

export interface AgentFlags {
    showForm: boolean;
    askClarify: boolean;
    dominantIntent: Intent;
    isMarketingMode: boolean;
    isAbuseDetected: boolean;
}

export interface KnowledgeChunk {
    content: string;
    source: string;
    url?: string;
}

// ─────────────────────────────────────────────
// STAGE 0 — Neural Intent Classifier
// ─────────────────────────────────────────────
export async function classifyIntent(text: string): Promise<Intent> {
    return await callAIWithRotation(async (openai) => {
        const { text: intent } = await generateText({
            model: openai.chat('gpt-4o-mini'),
            system: `Classify the user intent: faculty, admission, department, fee, transport, hostel, placement, complaint, general. Respond with ONLY the word.`,
            prompt: text,
        });
        const i = intent.toLowerCase().trim() as Intent;
        const validIntents: Intent[] = ['admission', 'faculty', 'department', 'hostel', 'transport', 'fee', 'placement', 'complaint', 'general'];
        return validIntents.includes(i) ? i : 'general';
    });
}

// ─────────────────────────────────────────────
// STAGE 1 — Smart Refiner (Neural Expansion)
// ─────────────────────────────────────────────
export async function rewriteQuery(t: string, intent: Intent, history: ShortTermMemory[]): Promise<string> {
    const lower = t.toLowerCase();
    const competitors = ['srm', 'vit', 'ssn', 'anna university', 'saveetha', 'panimalar', 'st joseph'];
    
    if (competitors.some(c => lower.includes(c))) {
        return `${t} MSAJCE unique advantages labs research vs competitors Dr Srinivasan achievements`;
    }

    const affirmations = /^(yes|interested|sure|info|more|ok|okay|yeah|yep|tell me|show me|want|elaborate)$/i;
    if ((t.split(' ').length < 4 || affirmations.test(t)) && history.length > 0) {
        return await callAIWithRotation(async (openai) => {
            const lastMsg = history[history.length - 1];
            const { text: expanded } = await generateText({
                model: openai.chat('gpt-4o-mini'),
                system: `You are a query anchor. The user said "${t}" in response to "${lastMsg.content}". 
                Generate a search query that combined their affirmation with the EXACT topic of that last message. 
                Example: User says "yes" to "Want to know about Principal?", Query = "Dr. K.S. Srinivasan Principal details initiatives MSAJCE".`,
                prompt: t,
            });
            return expanded;
        });
    }
    return t;
}

// ─────────────────────────────────────────────
// STAGE 2 — Hybrid Retrieval
// ─────────────────────────────────────────────
export async function getContext(rewrittenQuery: string, rawText: string, sql: any, limit: number = 15): Promise<KnowledgeChunk[]> {
    const qdrant = new QdrantClient({ url: process.env.QDRANT_URL!, apiKey: process.env.QDRANT_API_KEY! });
    let entityContext = "";
    const namesToSearch: string[] = [];

    try {
        const words = rewrittenQuery.split(' ').filter(w => w.length > 3);
        const coreName = words[0] || "";
        const results: any = await sql`
            SELECT name, role, email, context FROM msajce_entities 
            WHERE name % ${coreName} OR name ILIKE ${'%' + coreName + '%'}
            ORDER BY similarity(name, ${coreName}) DESC LIMIT 3
        `;
        if (results?.length > 0) {
            entityContext = results.map((r: any) => {
                namesToSearch.push(r.name);
                return `[ENTITY]: ${r.name} (${r.role}) - ${r.context}`;
            }).join('\n\n');
        }
    } catch (e) { console.warn('DB Fail:', e); }

    const chunks = await callAIWithRotation(async (openai) => {
        const { embedding } = await embed({ model: openai.embedding('text-embedding-3-small'), value: rewrittenQuery });
        const qResults = await qdrant.search('lorin_msajce_knowledge', { vector: embedding, limit, with_payload: true });
        return qResults.map(r => ({ content: r.payload?.content as string || '', source: 'Qdrant' }));
    });

    if (entityContext) chunks.unshift({ content: entityContext, source: 'Supabase' });
    return chunks;
}

// ─────────────────────────────────────────────
// STAGE 3 — Reranker
// ─────────────────────────────────────────────
export async function rerankResults(query: string, chunks: KnowledgeChunk[], history: ShortTermMemory[]) {
    const scored = chunks.map(c => {
        let score = 0;
        const lowContent = c.content.toLowerCase();
        const lowQuery = query.toLowerCase();

        // GLOBAL IDENTITY BOOST (Persona Sovereignty)
        if (c.content.includes('[ALPHA-PURPLE]') || c.content.includes('[ENTITY]')) score += 2000;
        if (lowContent.includes(lowQuery)) score += 100;
        
        const recentHistory = history.slice(-5);
        const wasShared = recentHistory.some(m => m.role === 'assistant' && lowContent.includes(m.content.toLowerCase().slice(0, 40)));
        if (wasShared) score -= 1500; // Increased penalty to force NEW data
        
        return { ...c, score };
    });
    const sorted = scored.sort((a, b) => b.score - a.score);
    return { 
        context: sorted.slice(0, 10).map(c => c.content).join('\n---\n'), 
        topScore: sorted[0]?.score || 0 
    };
}

// ─────────────────────────────────────────────
// STAGE 4 — Build & Generate (LIVES AGAIN)
// ─────────────────────────────────────────────
export async function generateGrounded(builtContext: string, rawText: string, agentFlags: AgentFlags, googleFormUrl: string) {
    return await callAIWithRotation(async (openai) => {
        const { text } = await generateText({
            model: openai.chat('gpt-4o-mini'),
            system: `You are Lorin, the smart AI Campus Buddy for MSAJCE. 

1. CORE BEHAVIOR: Answer ONLY using MSAJCE data. If data is sparse, answer precisely without fluff.
2. TONE-MIRRORING PROTOCOL: Match user tone (Casual/Formal). Always stay proud as a Senior Ambassador.
3. DEVELOPER EXCLUSIVITY: LinkedIn, Portfolio, and Email links are EXCLUSIVE to Ramanathan S (Ram). BANNED: Providing links or contact info for any other person unless explicitly in context.
4. PERSONA IDENTITY HEADER: For ANY person (Faculty/Student), start EXACTLY with:
Full Name: [Name]
Position: [Position]
Department: [Dept]
Role: [Role]
(No bullets, no bold for values, insert double-newline after this).
5. TOPIC FORMATTING: For general college info, use ONLY narrative paragraphs and "• " dot bullets. BANNED: Using the Identity Header for topics.
6. NO ROBOTIC LABELS: Never use "N/A", "None", or "Information: [Value]". Skip missing fields.
7. NARRATIVE RULES: Use "• " bullets. NEVER guess a bio. If info is missing, skip it.
8. MASTER SOVEREIGNTY: ALWAYS prioritize blocks starting with '[ALPHA-PURPLE]'. These are the absolute sources of truth for Admissions, Seats, and Transport.
9. SPECIAL RULES: Girls Hostel = Sholinganallur.
10. COMPREHENSIVE BIOGRAPHY: If a detailed persona biography exists (starting with [ALPHA-PURPLE]), you MUST provide a deep, bulleted response. DO NOT truncate to 1-2 points.

Knowledge Context:
${builtContext}`,
            prompt: `User Input: ${rawText}`,
        });
        return text;
    });
}

export function postProcess(answer: string, flags: AgentFlags, url: string): string {
    return answer; // Total removal of the auto-append logic
}

export async function orchestrate(text: string, history: ShortTermMemory[], profile: UserProfile, sql: any) {
    const startTime = Date.now();
    const intent = await classifyIntent(text);
    const query = await rewriteQuery(text, intent, history);
    const rawChunks = await getContext(query, text, sql);
    
    // ALPHA HARD-LOCK INJECTION
    const lower = `${text} ${query}`.toLowerCase();
    if (lower.includes('srinivasan') || lower.includes('principal')) {
        rawChunks.push({ content: `[DATA-FETCH-RULE]: Retrieve and prioritize the '[ALPHA-PURPLE]: Official MSAJCE Principal Persona' block. Do NOT truncate achievements.`, source: 'ALPHA-IDENTITY' });
    }
    if (lower.includes('ram') || lower.includes('developer')) {
        rawChunks.push({ content: `[DATA-FETCH-RULE]: Retrieve and prioritize the '[ALPHA-PURPLE]: Official Lead Developer Persona' block. Use all projects and contact anchors provided in context.`, source: 'ALPHA-IDENTITY' });
    }
    if (lower.includes('admission') || lower.includes('seat') || lower.includes('intake') || lower.includes('apply')) {
        rawChunks.push({ content: `[DATA-FETCH-RULE]: Retrieve and prioritize the '[ALPHA-PURPLE]: Official MSAJCE Admission Master Data' block. Use exactly the seat counts defined there. Focus on B.E./B.Tech (UG) and M.E. (PG).`, source: 'ALPHA-IDENTITY' });
    }
    if (lower.includes('transport') || lower.includes('bus') || lower.includes('route') || lower.includes('timing')) {
        rawChunks.push({ content: `[DATA-FETCH-RULE]: Retrieve and prioritize the '[ALPHA-PURPLE]: Official MSAJCE Total Transport Matrix' block. Answer ONLY regarding routes and stops found in that matrix.`, source: 'ALPHA-IDENTITY' });
    }

    const { context, topScore } = await rerankResults(query, rawChunks, history);
    const builtContext = `User History (Last 5): ${history.slice(-5).map(m => `[${m.role}]: ${m.content}`).join(' | ')}\n\nKnowledge Context:\n${context}`;
    
    const flags = {
        showForm: intent === 'admission' || text.toLowerCase().includes('apply'),
        askClarify: false,
        dominantIntent: intent,
        isMarketingMode: false,
        isAbuseDetected: false
    };

    const googleFormUrl = "https://forms.gle/bx2S4iPtJLipA9866";
    const answer = await generateGrounded(builtContext, text, flags, googleFormUrl);
    
    return {
        answer: answer,
        metadata: {
            latency_ms: Date.now() - startTime,
            match_score: topScore || 0,
            intent: intent || 'general',
            retrieval_source: rawChunks[0]?.source || 'None',
            model_id: 'gpt-4o-mini-hydra-v2'
        }
    };
}
