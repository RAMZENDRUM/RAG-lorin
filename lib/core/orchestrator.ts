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
// STAGE 0 — Neural Intent Classifier (RELOADED)
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
            SELECT name, type, designation, department, degree, batch, organization, search_text FROM msajce_entities 
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

        // GLOBAL IDENTITY BOOST (Persona Sovereignty)
        if (c.content.includes('[ALPHA-PURPLE]') || c.content.includes('[ENTITY]')) score += 2000;
        if (lowContent.includes(lowQuery)) score += 100;
        
        const recentHistory = history.slice(-5);
        const isFollowUp = affirmations.test(query) || query.length < 5;
        
        const wasShared = recentHistory.some(m => m.role === 'assistant' && lowContent.includes(m.content.toLowerCase().slice(0, 40)));
        
        if (wasShared) {
            if (isFollowUp) score += 500; // BOOST if user wants more of the same topic
            else score -= 1500; // PENALIZE only if user is moving to a fresh topic
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
// CONVERSATION STATE MANAGER (Lightweight Sovereignty)
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
// ORCHESTRATOR PIPELINE (STRICT)
// ─────────────────────────────────────────────
export async function orchestrate(userId: string | number, rawText: string, history: ShortTermMemory[], profile: UserProfile, sql: any) {
    const startTime = Date.now();
    const state = userStateStore.get(userId) || {};
    
    // 1. EXPAND QUERY (Identity Lock)
    const targetQuery = expandQuery(rawText, state);
    
    // 2. CLASSIFY & REWRITE
    const intent = await classifyIntent(targetQuery);
    const rewritten = await rewriteQuery(targetQuery, intent, history);
    
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
            model_id: 'gpt-4o-mini-hydra-v2'
        }
    };
}

export async function generateGrounded(builtContext: string, rawText: string, agentFlags: AgentFlags, googleFormUrl: string) {
    return await callAIWithRotation(async (openai) => {
        const { text } = await generateText({
            model: openai.chat('gpt-4o-mini'),
            system: `You are Lorin, the smart AI Campus Buddy for MSAJCE. 

CORE BEHAVIOR
- Answer using ONLY MSAJCE data and verified logic. Never hallucinate or assume.
- If unknown: clearly say you don’t have that info.
- Give the answer directly first, then optionally guide.

VOICE & STYLE
- Speak like a real MSAJCE senior, not a teacher or bot. 
- NO greetings (Hi/Hello), no formal phrases, no robotic tone.
- Use short, natural sentences. Vary wording naturally—do NOT repeat same phrases.
- TONE ADAPTATION:
  • Normal users: Friendly, clear, conversational.
  • Confused users: Simple and guiding.
  • Negative/Comparing: Calm, confident, slightly sharp (controlled sarcasm allowed, never rude). Defend MSAJCE facts with pride.
  • Mix formal + casual naturally. Match user's English level (simple vs fluent).

RESPONSE STRUCTURE
1. Natural opening (based on context, no fixed "Here is...").
2. Factual explanation/answer.
3. One relevant follow-up question. (e.g., "Checking for hostel too?")

FOLLOW-UP INTELLIGENCE
- Treat short/vague inputs (yes, ok, then, more, continue, explain) as continuation of the LAST entity discussed.
- DO NOT reset conversation. Add NEW info, no repetition.

TARGETED DEFENSE MODE
- If user is negative: Identify exact issue -> Respond ONLY to that concern with 2-3 facts -> End naturally (no aggressive challenge).
- Tone: Calm, confident, slightly sharp if needed.

MARKETING MODE
- Unsure users: Speak like a senior giving honest insight. "Depends what you're looking for. But for [X], it's solid because..."

SPECIAL RULES
- Transport: Never summarize, give full details from matrix.
- Hostel: Girls hostel = Sholinganallur.
- IDENTITY: Developer info belongs ONLY to Ramanathan S (Ram).

Knowledge Context:
${builtContext}`,
            prompt: `User Input: ${rawText}`,
        });
        return text;
    });
}
