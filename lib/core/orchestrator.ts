import { embed, generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { QdrantClient } from '@qdrant/js-client-rest';
import dotenv from 'dotenv';
import type { ShortTermMemory, UserProfile } from './memory.js';
export { fetchMemory, updateProfile, extractInterest } from './memory.js';

dotenv.config();

// ─────────────────────────────────────────────
// AI CONFIGURATION (Unified & Load-Balanced)
// ─────────────────────────────────────────────
export function getDynamicAIClient() {
    const keys = [
        process.env.VERCEL_AI_KEY,
        process.env.VERCEL_AI_KEY_2,
        process.env.VERCEL_AI_KEY_3,
        process.env.VERCEL_AI_KEY_4
    ].filter(Boolean);
    
    // Pick a random key or fallback to default
    const key = keys.length > 0 
        ? keys[Math.floor(Math.random() * keys.length)] 
        : process.env.OPENAI_API_KEY;

    // GATEWAY AUTO-ROUTING: If it's a Vercel key (vck_), it MUST use the gateway URL.
    const isVercelKey = key?.startsWith('vck_');
    const gatewayUrl = "https://ai-gateway.vercel.sh/v1";
    
    return createOpenAI({ 
        apiKey: key,
        baseURL: isVercelKey ? gatewayUrl : (process.env.VERCEL_AI_GATEWAY_URL || 'https://api.openai.com/v1')
    });
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

const HARD_LINK_MAP: Record<string, string> = {
    "principal": "https://www.msajce-edu.in/principal.php",
    "admin": "https://www.msajce-edu.in/administration.php",
    "governing council": "https://www.msajce-edu.in/governingcouncil.php",
    "transport": "https://www.msajce-edu.in/transport.php",
    "placement": "https://www.msajce-edu.in/placement.php"
};

// ─────────────────────────────────────────────
// STAGE 0 — Neural Intent Classifier
// ─────────────────────────────────────────────
export async function classifyIntent(text: string, openai: any): Promise<Intent> {
    try {
        const { text: intent } = await generateText({
            model: openai.chat('gpt-4o-mini'),
            system: `Classify the user intent: faculty, admission, department, fee, transport, hostel, placement, complaint, general. Respond with ONLY the word.`,
            prompt: text,
        });
        const i = intent.toLowerCase().trim() as Intent;
        const validIntents: Intent[] = ['admission', 'faculty', 'department', 'hostel', 'transport', 'fee', 'placement', 'complaint', 'general'];
        return validIntents.includes(i) ? i : 'general';
    } catch { return 'general'; }
}

// ─────────────────────────────────────────────
// STAGE 1 — Smart Refiner (Query Expansion)
// ─────────────────────────────────────────────
export function rewriteQuery(t: string, intent: Intent, profile: UserProfile, history: ShortTermMemory[]): string {
    const templates: Record<string, string> = {
        admission: `${t} admission procedure criteria cutoff MSAJCE`,
        transport: `${t} transport bus routes pickup MSAJCE`,
        placement: `${t} placement companies recruiters MSAJCE`,
        faculty:   `${t} personnel contact MSAJCE staff`,
        general:   `${t} MSAJCE college information`,
    };
    return templates[intent] || t;
}

// ─────────────────────────────────────────────
// STAGE 2 — Hybrid Retrieval (DEEP FUSION UPGRADE)
// ─────────────────────────────────────────────
export async function hybridRetrieve(rewrittenQuery: string, rawText: string, openai: any, db?: any, limit: number = 20): Promise<KnowledgeChunk[]> {
    let entityContext = "";
    let namesToSearch: string[] = [];

    // 1. Database Entity Lock
    try {
        if (db) {
            const clean = rewrittenQuery.replace(/who|is|the|about|tell/gi, '').trim();
            const results = await db`
                SELECT name, role, department, context, type, phone, email, linkedin, portfolio
                FROM msajce_entities 
                WHERE name % ${clean} 
                OR name ILIKE ${'%' + clean + '%'}
                ORDER BY similarity(name, ${clean}) DESC
                LIMIT 3
            `;
            if (results?.length > 0) {
                entityContext = results.map((r: any) => {
                    namesToSearch.push(r.name);
                    return `[ENTITY]: Name: ${r.name} | Role: ${r.role} | Email: ${r.email} | LinkedIn: ${r.linkedin} | Portfolio: ${r.portfolio} | Context: ${r.context}`;
                }).join('\n\n');
            }
        }
    } catch (e) { console.warn('DB Search Fail:', e); }

    // 2. Vector Search (Primary)
    const qdrant = new QdrantClient({ url: process.env.QDRANT_URL!, apiKey: process.env.QDRANT_API_KEY! });
    const { embedding } = await embed({ model: openai.embedding('text-embedding-3-small'), value: rewrittenQuery });
    const qResults = await qdrant.search('lorin_msajce_knowledge', { vector: embedding, limit, with_payload: true });

    // 3. TARGETED VECTOR BOOST: Search specifically for found entity names in vector DB
    let extraChunks: KnowledgeChunk[] = [];
    if (namesToSearch.length > 0) {
        for (const name of namesToSearch) {
            const { embedding: nameEmbed } = await embed({ model: openai.embedding('text-embedding-3-small'), value: `About ${name} MSAJCE` });
            const deepResults = await qdrant.search('lorin_msajce_knowledge', { vector: nameEmbed, limit: 3, with_payload: true });
            deepResults.forEach(r => extraChunks.push({ content: r.payload?.content as string || '', source: 'Qdrant-Deep' }));
        }
    }

    const chunks: KnowledgeChunk[] = qResults.map(r => ({ content: r.payload?.content as string || '', source: r.payload?.source as string || '' }));
    
    // Merge everything
    if (entityContext) chunks.unshift({ content: entityContext, source: 'Supabase-Entity' });
    if (extraChunks.length > 0) chunks.push(...extraChunks);
    
    return chunks;
}

// ─────────────────────────────────────────────
// STAGE 3 — Reranker
// ─────────────────────────────────────────────
export async function rerankResults(query: string, chunks: KnowledgeChunk[], openai: any) {
    const scored = chunks.map(c => {
        let score = 0;
        if (c.content.includes('[ENTITY]')) score += 1000;
        if (c.content.toLowerCase().includes(query.toLowerCase())) score += 100;
        return { ...c, score };
    });
    const sorted = scored.sort((a, b) => b.score - a.score);
    return { 
        context: sorted.slice(0, 8).map(c => c.content).join('\n---\n'), 
        topScore: sorted[0]?.score || 0 
    };
}

// ─────────────────────────────────────────────
// STAGE 4 — Context Builder
// ─────────────────────────────────────────────
export function buildContext(retrievedContext: string, history: ShortTermMemory[], profile: UserProfile): string {
    return `User History (Last 10 msgs): ${history.slice(-10).map(m => m.content).join(' | ')}\n\nKnowledge Context:\n${retrievedContext}`;
}

// ─────────────────────────────────────────────
// STAGE 5 — Agent Decision Logic
// ─────────────────────────────────────────────
export function agentDecide(
    intent: Intent,
    rawText: string,
    context: string,
    lastSeen: any,
    googleFormUrl: string
): AgentFlags {
    return {
        showForm: intent === 'admission' || rawText.toLowerCase().includes('apply'),
        askClarify: rawText.split(' ').length < 3 && !context,
        dominantIntent: intent,
        isMarketingMode: false,
        isAbuseDetected: false
    };
}

// ─────────────────────────────────────────────
// STAGE 6 — Grounded Generation (DYNAMISM UPGRADE)
// ─────────────────────────────────────────────
export async function generateGrounded(builtContext: string, rawText: string, agentFlags: AgentFlags, googleFormUrl: string, openai: any) {
    const { text } = await generateText({
        model: openai('gpt-4o-mini'),
        system: `You are Lorin, the smart AI Campus Buddy for MSAJCE. 

STRICT FORMATTING RULES:
1. FRIENDLY & NATURAL: Talk like a helpful campus buddy. Start with a warm, brief greeting and end with a friendly follow-up question to stay interactive.
2. BULLETPOINTS FOR DATA: Use standalone narrative bullet points starting with a dash (-) for the main facts and contact details.
3. NO ROBOT LABELS: Never use "Position:", "Role:", "LinkedIn:", "Portfolio:", "Email:", or "Expertise:". Convert these into descriptive sentences.
4. INClUDE CONTACTS: Always weave verified contact info (Email, LinkedIn, Portfolio) into the narrative bullets.
5. IDENTITY RULE: For Ramanathan S (Lead Architect), use these exact bullet points:
   - Lead AI Architect and creator of the Lorin RAG intelligence system.
   - Currently pursuing a B.Tech in Information Technology at MSAJCE.
   - Creator of key campus solutions like the College Bus Tracking App and the Smart Hostel Web App.
   - LinkedIn: https://www.linkedin.com/in/ramanathan-s-76a0a02b1
   - Portfolio: https://ram-ai-portfolio.vercel.app
   - Contact: ramanathanb86@gmail.com
6. DATA FUSION: If context contains [ENTITY], use it as the absolute source of truth for names and contacts.
7. LINGUISTIC MIRROR: Adapt English level (B1-C2) to match the user.
8. NO AURA: You are Lorin.`,
        prompt: `${builtContext}\n\nUSER: ${rawText}`,
    });
    return text;
}

// ─────────────────────────────────────────────
// STAGE 7 — Post-Processor
// ─────────────────────────────────────────────
export function postProcess(answer: string, agentFlags: AgentFlags, googleFormUrl: string, chunks: KnowledgeChunk[], raw: string): string {
    return answer; // Basic version for now
}

// ─────────────────────────────────────────────
// STAGE 100 — Master Orchestrator
// ─────────────────────────────────────────────
export async function orchestrate(
    rawText: string,
    intent: Intent,
    shortTerm: ShortTermMemory[],
    profile: UserProfile,
    openai: any,
    sql: any,
    updateId: string,
    injectedContext: string = ""
): Promise<{ answer: string }> {
    const googleFormUrl = "https://forms.gle/msajce-enquiry";
    const rewritten = rewriteQuery(rawText, intent, profile, shortTerm);
    
    // Deep Hybrid Retrieval with targeted vector lookup for entities
    const chunks = await hybridRetrieve(rewritten, rawText, openai, sql);
    
    if (injectedContext) chunks.unshift({ content: injectedContext, source: 'SYSTEM' });

    const { context } = await rerankResults(rewritten, chunks, openai);
    const builtContext = buildContext(context, shortTerm, profile);
    
    const agentFlags = agentDecide(intent, rawText, context, profile.last_seen, googleFormUrl);
    const answer = await generateGrounded(builtContext, rawText, agentFlags, googleFormUrl, openai);
    const finalAnswer = postProcess(answer, agentFlags, googleFormUrl, chunks, rawText);
    
    return { answer: finalAnswer };
}
