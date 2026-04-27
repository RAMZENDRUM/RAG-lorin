// @ts-ignore
import * as fs from 'fs';
// @ts-ignore
import * as path from 'path';
import { embed, generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { QdrantClient } from '@qdrant/js-client-rest';
// @ts-ignore
import * as dotenv from 'dotenv';
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
    
    // Attempt rotation
    const key = keys[attempt % keys.length] || process.env.OPENAI_API_KEY;
    const isVercelKey = key?.startsWith('vck_');
    
    return createOpenAI({ 
        apiKey: key,
        baseURL: isVercelKey ? "https://ai-gateway.vercel.sh/v1" : 'https://api.openai.com/v1'
    });
}

async function callAIWithRotation(fn: (openai: any) => Promise<any>, maxRetries: number = 3) {
    const keysCount = [
        process.env.OPENAI_API_KEY, 
        process.env.VERCEL_AI_KEY,
        process.env.VERCEL_AI_KEY_2,
        process.env.VERCEL_AI_KEY_3,
        process.env.VERCEL_AI_KEY_4
    ].filter(Boolean).length;

    const actualMaxRetries = Math.max(maxRetries, keysCount - 1);

    for (let i = 0; i <= actualMaxRetries; i++) {
        const openai = getDynamicAIClient(i);
        try {
            return await fn(openai);
        } catch (error: any) {
            // ROTATION TRIGGERS: Rate Limit (429) OR Insufficient Funds (402)
            const isRotateTrigger = 
                error.statusCode === 429 || 
                error.statusCode === 402 || 
                error.message?.toLowerCase().includes('rate limit') || 
                error.message?.toLowerCase().includes('insufficient funds') ||
                error.message?.toLowerCase().includes('credits');

            if (isRotateTrigger && i < actualMaxRetries) {
                console.warn(`🔄 AI KEY ROTATION: Stage ${i} failed (${error.statusCode || 'Error'}). Trying next key in pool...`);
                continue;
            }
            console.error(`❌ AI EXECUTION FAILED at Stage ${i}:`, error.message || error);
            throw error;
        }
    }
}

// ─────────────────────────────────────────────
// TYPES & CONSTANTS
// ─────────────────────────────────────────────
export type Intent = 'admission' | 'faculty' | 'department' | 'hostel' | 'transport' | 'fee' | 'placement' | 'complaint' | 'general';
const affirmations = /^(yes|interested|sure|info|more|ok|okay|yeah|yep|tell me|show me|want|elaborate)$/i;

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
// STAGE 0 & 1 — AI Logic (Legacy wrappers removed)
// ─────────────────────────────────────────────

// ─────────────────────────────────────────────
// STAGE 2 — Hybrid Retrieval
// ─────────────────────────────────────────────
export async function getContext(rewrittenQuery: string, rawText: string, sql: any, limit: number = 15): Promise<KnowledgeChunk[]> {
    const qdrant = new QdrantClient({ url: process.env.QDRANT_URL!, apiKey: process.env.QDRANT_API_KEY! });
    let entityContext = "";
    const namesToSearch: string[] = [];

    try {
        const results: any = await sql`
            SELECT name, type, designation, department, search_text FROM msajce_entities 
            WHERE search_text % ${rewrittenQuery} OR name ILIKE ${'%' + rewrittenQuery + '%'}
            ORDER BY similarity(search_text, ${rewrittenQuery}) DESC LIMIT 5
        `;
        if (results?.length > 0) {
            entityContext = results.map((r: any) => {
                namesToSearch.push(r.name);
                return `[ENTITY]: ${r.name} | Type: ${r.type} | Designation: ${r.designation} | Dept: ${r.department || 'General'} | Case: ${r.search_text}`;
            }).join('\n\n');
        }
    } catch (e) { console.warn('DB Fail:', e); }

    const chunks = await callAIWithRotation(async (openai) => {
        const { embedding } = await embed({ model: openai.embedding('text-embedding-3-small'), value: rewrittenQuery });
        const qResults = await qdrant.search('lorin_msajce_knowledge', { vector: embedding, limit, with_payload: true });
        return qResults.map(r => ({ content: r.payload?.content as string || '', source: 'Qdrant' }));
    });

    if (entityContext) chunks.unshift({ content: entityContext, source: 'Supabase' });

    // MASTER SOVEREIGNTY LOCK
    for (const name of namesToSearch) {
        const lastName = name.split(' ').pop()?.toLowerCase();
        if (lastName) {
            const personaPath = path.join(process.cwd(), 'data', 'personas', `${lastName}.persona.txt`);
            if (fs.existsSync(personaPath)) {
                const masterBio = fs.readFileSync(personaPath, 'utf8');
                chunks.unshift({ content: masterBio, source: 'MasterPersona' });
                console.log(`📡 Identity Lock Activated: ${name} (Priority Master)`);
            }
        }
    }

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

        if (c.content.includes('[ALPHA-PURPLE]') || c.content.includes('[ENTITY]')) score += 2000;
        if (lowContent.includes(lowQuery)) score += 100;
        
        const recentHistory = history.slice(-5);
        const isFollowUp = affirmations.test(query) || query.length < 5;
        const wasShared = recentHistory.some(m => m.role === 'assistant' && lowContent.includes(m.content.toLowerCase().slice(0, 40)));
        
        if (wasShared) {
            if (isFollowUp) score += 500;
            else score -= 1500;
        }
        
        return { ...c, score };
    });
    const sorted = scored.sort((a, b) => b.score - a.score);
    return { 
        context: sorted.slice(0, 10).map(c => c.content).join('\n---\n'), 
        topScore: sorted[0]?.score || 0 
    };
}

// ─────────────────────────────────────────────
// CONVERSATION STATE MANAGER
// ─────────────────────────────────────────────
interface ConversationState {
    lastTopic?: string;
    lastEntity?: string;
    lastIntent?: Intent;
    lastOptions?: string[];
}

const userStateStore = new Map<string | number, ConversationState>();

export function isFollowUp(msg: string) {
    const clean = msg.toLowerCase().trim();
    if (clean.length < 15 && !/[a-z]{4,}/.test(clean)) return true;
    const vaguePatterns = ["yes", "ok", "hmm", "then", "and", "more", "continue", "what next", "so", "like that", "details"];
    return vaguePatterns.some(p => clean.includes(p));
}

export function expandQuery(userMsg: string, state: ConversationState) {
    if (!isFollowUp(userMsg)) return userMsg;
    if (state.lastOptions?.length) return `Tell me about ${state.lastOptions[0]} in MSAJCE`;
    if (state.lastEntity) return `Give more details about ${state.lastEntity} in MSAJCE`;
    if (state.lastTopic) return `Explain more about ${state.lastTopic} in MSAJCE`;
    return userMsg;
}

function detectTopic(q: string, a: string): string {
    const combined = (q + ' ' + a).toLowerCase();
    if (combined.includes('bus') || combined.includes('transport')) return 'transport';
    if (combined.includes('hostel')) return 'hostel';
    if (combined.includes('admission') || combined.includes('seat')) return 'admission';
    if (combined.includes('placement') || combined.includes('job')) return 'placement';
    return 'general';
}

function extractOptions(answer: string): string[] {
    const match = answer.match(/\?(.*) or (.*)\?/i);
    return match ? [match[1].trim(), match[2].trim()] : [];
}

// ─────────────────────────────────────────────
// ORCHESTRATOR PIPELINE (STRICT & OPTIMIZED)
// ─────────────────────────────────────────────
export async function orchestrate(userId: string | number, rawText: string, history: ShortTermMemory[], profile: UserProfile, sql: any) {
    const startTime = Date.now();
    const state = userStateStore.get(userId) || {};
    
    // 1. FAST-TRACK GREETINGS
    const lowerRaw = rawText.toLowerCase().trim();
    const isSimpleGreeting = /^(hi|hello|hey|yo|greetings|namaste)$/i.test(lowerRaw) && rawText.split(' ').length < 3;
    
    if (isSimpleGreeting) {
        const answer = await generateGrounded(`User is greeting. Reply naturally like a senior.`, rawText, {
            showForm: false,
            askClarify: false,
            dominantIntent: 'general',
            isMarketingMode: false,
            isAbuseDetected: false
        }, "https://forms.gle/bx2S4iPtJLipA9866");
        
        return {
            answer: answer,
            metadata: {
                latency_ms: Date.now() - startTime,
                match_score: 0,
                intent: 'general',
                retrieval_source: 'Greeting-FastTrack',
                model_id: 'gpt-4o-mini-hydra-v2'
            }
        };
    }

    // 2. EXPAND QUERY & ANALYZE (Parallel AI Call)
    const targetQuery = expandQuery(rawText, state);
    
    const { intent, rewritten } = await callAIWithRotation(async (openai) => {
        const lastMsg = history.length > 0 ? history[history.length - 1] : null;
        const { text: analysis } = await generateText({
            model: openai.chat('gpt-4o-mini'),
            system: `Analyze the user query for MSAJCE. 
            Respond in EXACTLY this format:
            INTENT: [intent]
            REWRITTEN: [expanded query]
            
            Valid Intents: admission, faculty, department, hostel, transport, fee, placement, complaint, general.
            Expansion: If user says "yes" or follow-up, use context: "${lastMsg?.content || 'None'}".`,
            prompt: targetQuery,
        });
        
        const intentMatch = analysis.match(/INTENT: (.*)/i);
        const rewrittenMatch = analysis.match(/REWRITTEN: (.*)/i);
        
        return {
            intent: (intentMatch?.[1].toLowerCase().trim() || 'general') as Intent,
            rewritten: rewrittenMatch?.[1].trim() || targetQuery
        };
    });
    
    // 3. RETRIEVE
    const rawChunks = await getContext(rewritten, rawText, sql);
    
    // ALPHA HARD-LOCK INJECTION
    const lower = `${rawText} ${rewritten}`.toLowerCase();
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

    const { context, topScore } = await rerankResults(rewritten, rawChunks, history);
    const builtContext = `User History (Last 5): ${history.slice(-5).map(m => `[${m.role}]: ${m.content}`).join(' | ')}\n\nKnowledge Context:\n${context}`;
    
    // 4. GENERATE
    const answer = await generateGrounded(builtContext, rawText, {
        showForm: intent === 'admission',
        askClarify: rawChunks.length === 0,
        dominantIntent: intent,
        isMarketingMode: false,
        isAbuseDetected: false
    }, "https://forms.gle/bx2S4iPtJLipA9866");

    // 5. UPDATE STATE (Subject Tracking)
    const entityMatch = context.match(/\[ENTITY\]: (.*?) \|/);
    const newState: ConversationState = {
        lastTopic: detectTopic(rewritten, answer),
        lastEntity: entityMatch ? entityMatch[1] : state.lastEntity,
        lastIntent: intent,
        lastOptions: extractOptions(answer)
    };
    userStateStore.set(userId, newState);
    
    return {
        answer: answer,
        metadata: {
            latency_ms: Date.now() - startTime,
            match_score: topScore || 0,
            intent: intent || 'general',
            retrieval_source: rawChunks[0]?.source || 'None',
            model_id: 'gpt-4o-mini-hydra-v2-optimized'
        }
    };
}

export async function generateGrounded(builtContext: string, rawText: string, agentFlags: AgentFlags, googleFormUrl: string) {
    return await callAIWithRotation(async (openai) => {
        const { text } = await generateText({
            model: openai.chat('gpt-4o-mini'),
            system: `You are Lorin, the smart AI Campus Buddy for MSAJCE. 

CORE BEHAVIOR
- Answer using ONLY MSAJCE data and verified logic. Never hallucinate.
- If unknown: clearly say you don’t have that info.

VOICE & STYLE
- Speak like a natural MSAJCE senior. No bot-like greetings (Hi/Hello).
- 🚫 DO NOT use fixed openers like "See", "Actually", "If", or "What's on your mind?".
- 🚫 NEVER repeat the exact same phrase twice in a row. 
- For greetings (hello/hi): Respond naturally like a senior (e.g., "Yo, how's it going?", "Need some deets on a department?", "What's happening?").
- Use short, natural sentences. Mix formal + casual perfectly.

📦 ENTITY & PERSONNEL FORMATTING (STRICT)
If discussing a specific person (Faculty, Principal, Student Leader), use this precise layout:
1. Natural Opening (Vary this! NO fixed phrases like "Here's the rundown" or "Here's the scoop").
2. Identity Block (Key:: Value) - ONLY include verified lines. NO "N/A", "Unknown", or headers like "Key Facts":
   Name:: [Full Name]
   Role:: [Designation]
   Dept:: [Department]
   Education:: [Qualifications]
3. Rich Context (2-3 Detailed Bullet Points) - Use specific data (e.g., name specific book titles, patent numbers, or years). NO generic headers like "Context":
   • [Category]: [Specific Detail 1]
   • [Category]: [Specific Detail 2]
   • [Category]: [Specific Detail 3]
4. Natural Closing/Follow-up.

IDENTITY PROTECTION
- DEVELOPER: Ramanathan S (also known as Ram) is the sole developer. No one else.
- Transport: Always provide full route details from context.
- Hostel: Girls = Sholinganallur.

Knowledge Context:
${builtContext}`,
            prompt: `User Input: ${rawText}`,
        });
        return text;
    });
}
