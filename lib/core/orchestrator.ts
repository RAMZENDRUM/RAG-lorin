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
// STAGE 1 — Smart Refiner (Neural Expansion)
// ─────────────────────────────────────────────
export async function rewriteQuery(t: string, intent: Intent, history: ShortTermMemory[], openai: any): Promise<string> {
    const lower = t.toLowerCase();
    
    // Targeted Defense: Detect competitors and force institutional edge retrieval
    const competitors = ['srm', 'vit', 'ssn', 'anna university', 'saveetha', 'panimalar', 'st joseph'];
    const isComparison = competitors.some(c => lower.includes(c));
    if (isComparison) {
        return `${t} MSAJCE unique advantages placements hackathons NIRF research versus competitors Dr Srinivasan achievements`;
    }

    // If the query is very short, use AI to resolve what "it/him/yes/more" means
    if (t.split(' ').length < 3 && history.length > 0) {
        try {
            const { text: expanded } = await generateText({
                model: openai.chat('gpt-4o-mini'),
                system: `You are a query expansion engine for the Lorin RAG bot. 
                Your task: Look at the last thing the ASSISTANT said and determine what the user is referring to with "${t}".
                If the assistant just finished talking about a person or department, INCLUDE their name in the expanded query.
                Example: Assistant said "Want more info on Dr. Srinivasan?", User said "yes" -> Result: "Detailed initiatives and contributions of Dr. K.S. Srinivasan MSAJCE".
                Respond ONLY with the expanded search query.`,
                prompt: `History (Assistant's Last Message): ${history[history.length - 1]?.content}\nUser Response: ${t}`,
            });
            return expanded.trim();
        } catch { return t; }
    }

    const templates: Record<string, string> = {
        admission: `${t} admission procedure criteria cutoff MSAJCE`,
        transport: `${t} transport bus routes pickup MSAJCE`,
        placement: `${t} placement companies recruiters MSAJCE`,
        faculty:   `${t} personnel contact research publications MSAJCE staff`,
        general:   `${t} MSAJCE college information unique features`,
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
            // Sharpen the name lookup - isolate core subject
            const coreName = rawText.replace(/who|is|the|about|tell|me|more|abt|he/gi, '').trim();
            const results = await db`
                SELECT name, role, department, context, type, phone, email, linkedin, portfolio
                FROM msajce_entities 
                WHERE name % ${coreName} 
                OR name ILIKE ${'%' + coreName + '%'}
                OR name % ${rawText}
                ORDER BY similarity(name, ${coreName}) DESC
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
export async function rerankResults(query: string, chunks: KnowledgeChunk[], history: ShortTermMemory[], openai: any) {
    const scored = chunks.map(c => {
        let score = 0;
        const lowContent = c.content.toLowerCase();
        const lowQuery = query.toLowerCase();

        if (c.content.includes('[ENTITY]')) score += 1000;
        if (lowContent.includes(lowQuery)) score += 100;
        
        // Anti-Repetition: Penalize chunks containing facts already shared in the conversation
        const wasShared = history.some(m => 
            m.role === 'assistant' && 
            (m.content.toLowerCase().includes(lowContent.slice(0, 50)) || lowContent.includes(m.content.toLowerCase().slice(0, 50)))
        );
        if (wasShared) score -= 800; // Heavy penalty for repetition

        // Quality Boost: Prioritize chunks with specific names or technical details (books, patents)
        if (lowContent.includes('patent') || lowContent.includes('isbn') || lowContent.includes('manual')) score += 200;

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

STRICT FORMATTING & VOICE RULES:
1. FACT-ONLY BULLETS: Bullet points must ONLY contain factual data. NEVER put helpful phrases like "feel free to ask" in a bullet.
2. RADICAL HONESTY: If a personal contact is missing, say "I don't have his direct contact details" before fallback.
3. ALPHA SUPREMACY (DEVELOPER): [ALPHA PROFILE] is the ABSOLUTE TRUTH for Ramanathan S. If any retrieved data conflicts with Alpha (especially email or links), ALWAYS use the Alpha Data (Email: ramanathanb86@gmail.com). Include his LinkedIn (https://www.linkedin.com/in/ramanathan-s-76a0a02b1).
4. ALPHA SUPREMACY (PRINCIPAL): [ALPHA PROFILE] is the ABSOLUTE TRUTH for Dr. K.S. Srinivasan.
   - Achievements: Author of 16 Engineering Textbooks (Communication Theory, DSP, WSN, etc.).
   - Invention: Patent Holder for "A Smart Device to Monitoring the Optic Cable" (2022).
   - Roles: Secretary of TNSCST (Govt of Tamil Nadu) and President of NISP.
   - Identity: He is not just "The Principal"; he is a distinguished researcher and author. Prioritize these technical achievements.
5. NO ROBOTIC FILLER: Strictly forbid clichés like "Have a great day!", "Wishing you a...".
6. NATURAL WARMTH: Greetings/sign-offs are allowed and should be responded to warmly.
7. LINGUISTIC MIRRORING: Match user's English level (B1-C2) perfectly.
8. SINGLE-LINE BULLETS: Use a dash (-). No double spaces.
9. NO AURA: You are Lorin.

--------------------------------------------------

ANSWERING BEHAVIOR RULES (REFINED):

8. MESSAGE TYPE DETECTION (CRITICAL):
- GREETING → respond warmly like a friend and mention users can provide feedback to help Lorin learn.
- ACKNOWLEDGEMENT/THANKS/BYE → respond briefly and warmly (e.g., "Happy to help!", "See ya!").
- QUESTION → give full answer based on facts.
- FOLLOW-UP → continue previous context, do not repeat.

--------------------------------------------------

9. ANTI-REPETITION (STRICT): Scan [HISTORY]. Do NOT repeat facts, sentences, or statistics already shared. If the user asks to "know more" or "elaborate," you MUST provide NEW specific details (education, research, projects, or career history) from [CONTEXT] that were skipped in previous turns.
10. NO MORE DATA FALLBACK: If [CONTEXT] has no new info, state: "I've shared everything I know about this specific topic," and propose a related topic (e.g., his department or related faculty). Never loop.
10. HUMAN REPHRASING: No copy-pasting report text. Explain naturally like a person.
11. NATURAL OPENING: Start humanly. Avoid "Dr. X is...". Prefer "Dr. X works as...".
12. PERSON QUERY: Identify them clearly and explain how students interact with them. Mention their research/books if they are distinguished (like Dr. Srinivasan).
13. CONTACT QUERY: If personal missing → admit it → give fallback → guide next step.
14. RELEVANCE CONTROL: Only include info directly related to the question. No title dumps.
15. RESPONSE STRUCTURE: Use short paragraphs for talk. Use bullets only for factual lists.
16. CONTEXT AWARENESS: Understand that "nice/ok" is an acknowledgement.
17. CONVERSATIONAL FLOW: Every reply should feel natural and move the chat forward.
18. DYNAMIC FOLLOW-UP GENERATION (CORE INTELLIGENCE):
The final sentence must be generated based on the user's query type. Never use generic follow-ups.
- IF query is about PERSON (faculty, principal, staff) → Suggest: department, subjects handled, or his books/publications.
- IF query is about TRANSPORT → Suggest: full route, nearby stop, or timing clarification.
- IF query is about ADMISSION → Suggest: courses, cutoff, or eligibility.
- IF query is about DEPARTMENTS / COURSES → Suggest: labs, placements, or syllabus.
- IF query is about HOSTEL / FACILITIES → Suggest: fees, rules, or location.
- IF query is GENERAL / ACKNOWLEDGEMENT → Suggest 2 strong core areas: transport or departments.

21. TARGETED DEFENSE MODE (CRITICAL):
When the user gives a negative statement or comparison (e.g., "SRM is better"):
- STEP 1 (IDENTIFY): Extract the concern.
- STEP 2 (FACTUAL DEFENSE): Use high-fidelity data like Dr. Srinivasan's 16 books, patents, and campus labs to show MSAJCE's deep technical quality over larger competitor "brands."
- STEP 3 (TONE): Be an Alpha Defender. Let facts do the talking. Mention specific industry links and research focus.
- STEP 4 (ANTI-LOOP): If challenged again on the same point, shift focus to a different strength (e.g., if placement challenged, shift to research/innovation).
`,
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
): Promise<{ answer: string, metadata: any }> {
    const startTime = Date.now();
    const googleFormUrl = "https://forms.gle/msajce-enquiry";

    const rewritten = await rewriteQuery(rawText, intent, shortTerm, openai);
    
    // Deep Hybrid Retrieval with targeted vector lookup for entities
    const chunks = await hybridRetrieve(rewritten, rawText, openai, sql);
    
    if (injectedContext) chunks.unshift({ content: injectedContext, source: 'SYSTEM' });

    const { context, topScore } = await rerankResults(rewritten, chunks, shortTerm, openai);
    const builtContext = buildContext(context, shortTerm, profile);
    
    const agentFlags = agentDecide(intent, rawText, context, profile.last_seen, googleFormUrl);
    const answer = await generateGrounded(builtContext, rawText, agentFlags, googleFormUrl, openai);
    const finalAnswer = postProcess(answer, agentFlags, googleFormUrl, chunks, rawText);
    
    const latency_ms = Date.now() - startTime;

    return { 
        answer: finalAnswer,
        metadata: {
            latency_ms,
            match_score: topScore,
            intent: intent, // intent is a string type
            tokens: 0, // Placeholder
            cost: 0,   // Placeholder
            retrieval_source: chunks[0]?.source || 'None',
            model_id: 'gpt-4o-mini'
        }
    };
}
