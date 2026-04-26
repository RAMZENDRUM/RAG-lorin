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

    // If the query is an affirmation (yes, interested, info, more, sure, ok), use AI to resolve context
    const affirmations = /^(yes|interested|sure|info|more|ok|okay|yeah|yep|tell me|show me|want|elaborate)$/i;
    if ((t.split(' ').length < 4 || affirmations.test(t)) && history.length > 0) {
        try {
            const { text: expanded } = await generateText({
                model: openai.chat('gpt-4o-mini'),
                system: `You are a query expansion engine for the Lorin RAG bot. 
                Your task: Look at the last thing the ASSISTANT suggested/asked and determine what details to fetch based on "${t}".
                If the user says "yes" or "interested" to a suggested topic (like labs, books, transport), EXPAND the query to fetch those specific details for MSAJCE.
                Example: Assistant said "Want more info on Dr. Srinivasan?", User said "yes" -> Result: "Detailed initiatives and contributions of Dr. K.S. Srinivasan MSAJCE".
                Example: Assistant said "Want to check placement stats?", User said "I'm interested" -> Result: "Detailed placement statistics companies salary MSAJCE".
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
        
        // Anti-Repetition: Penalize chunks containing facts shared in the LAST 5 messages
        const recentHistory = history.slice(-5);
        const wasShared = recentHistory.some(m => 
            m.role === 'assistant' && 
            (m.content.toLowerCase().includes(lowContent.slice(0, 50)) || lowContent.includes(m.content.toLowerCase().slice(0, 50)))
        );
        if (wasShared) score -= 800; // Heavy penalty for immediate repetition

        // Quality Boost: Prioritize chunks with specific names or technical details
        if (lowContent.includes('patent') || lowContent.includes('isbn') || lowContent.includes('manual')) score += 200;

        // Global Interest Boost: If the user is responding to a suggestion, boost matching chunks
        const isAffirmation = /^(yes|interested|sure|ok|okay|more|show|tell)$/i.test(query.toLowerCase());
        if (isAffirmation && history.length > 0) {
            const lastAssistantMsg = history[history.length - 1]?.content.toLowerCase() || "";
            // If this chunk contains keywords from the assistant's previous suggestion, boost it
            if (lowContent.split(' ').some(word => word.length > 4 && lastAssistantMsg.includes(word))) {
                score += 500;
            }
        }

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
    return `User History (Last 5 msgs): ${history.slice(-5).map(m => m.content).join(' | ')}\n\nKnowledge Context:\n${retrievedContext}`;
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
2. CONDITIONAL HONESTY: ONLY if the user specifically asks for contact details (email, phone, etc.) and they are missing, say "I don't have his direct contact details" before suggesting a fallback. Never volunteer this info for general "Who is" questions.
3. ALPHA SUPREMACY (DEVELOPER): [ALPHA PROFILE] is the ABSOLUTE TRUTH for Ramanathan S. Always use his provided links (LinkedIn: https://www.linkedin.com/in/ramanathan-s-76a0a02b1) and Official Email: ramanathanb86@gmail.com.
4. IDENTITY LOCK: You are Lorin. Prioritize high-fidelity context chunks (patents, books, specific roles) over generic "About Us" fluff.
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
10. PROACTIVE DELIVERY (STRICT): If the user says "yes," "interested," or "sure" to a suggestion, you MUST provide new details immediately. If context is exhausted, PIVOT to a new pillar.
11. NO CONFIRMATION TRAPS: Never ask "Would you like more details about [Topic]?" if the user just said "yes" to that topic. A "yes" is a command to Speak, not a prompt to ask. 
11. NO CLARIFICATION LOOPS: Strictly forbid asking "Could you specify?" or "What would you like to know?" if the Knowledge Context already contains data related to your previous message. Your job is to inform, not to gatekeep.
12. NATURAL OPENING: Start humanly. Avoid "Dr. X is...". Prefer "Dr. X works as...".
12. PERSON QUERY: Identify them clearly and explain how students interact with them. Mention their research/books if they are distinguished (like Dr. Srinivasan).
13. CONTACT QUERY (SPECIFIC): If user asks for contact → check context → if missing, admit it briefly → give department fallback.
14. RELEVANCE CONTROL: Only include info directly related to the question. No title dumps.
15. RESPONSE STRUCTURE: Use short paragraphs for talk. Use bullets only for factual lists.
16. CONTEXT AWARENESS: Understand that "nice/ok" is an acknowledgement.
17. CONVERSATIONAL FLOW: Every reply should feel natural and move the chat forward.
18. DYNAMIC FOLLOW-UP & PIVOT (CRITICAL): The final sentence must be exactly ONE question. 
- IF you just provided info → ask a strictly related follow-up (e.g., "Want his department?").
- IF you have NO new info or are asking for "Specifics" for the second time in a row → PIVOT GLOBALLY. Recommend a different high-value topic: "I have shared his core highlights. Would you like to check MSAJCE's transport routes or our main departments instead?"
- Never ask a generic "How can I help you?" Always propose a specific asset (Transport, Principal, or Departments).

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
    
    // 1. Fetch Dynamic Knowledge Chunks
    const chunks = await hybridRetrieve(rewritten, rawText, openai, sql);
    
    // 2. Identify and Inject Alpha Profiles (Context-Aware: checks both User Text and Rewritten Query)
    const contextText = `${rawText} ${rewritten}`.toLowerCase();
    const lastMsg = shortTerm[shortTerm.length - 1]?.content.toLowerCase() || "";

    if (contextText.includes('srinivasan') || contextText.includes('principal') || lastMsg.includes('srinivasan')) {
        chunks.push({ 
            content: `[ALPHA-PRINCIPAL]: Dr. K.S. Srinivasan is a distinguished researcher and the Principal of MSAJCE. 
            He is the author of 16 Engineering Textbooks (including Communication Theory, Digital Signal Processing, Wireless Sensor Networks). 
            He holds a 2022 patent for "A Smart Device to Monitoring the Optic Cable". 
            He serves as the Secretary of TNSCST (Government of Tamil Nadu) and President of NISP.`, 
            source: 'ALPHA-CORE' 
        });
    }
    if (contextText.includes('ram') || contextText.includes('developer') || lastMsg.includes('ram')) {
        chunks.push({
            content: `[ALPHA-DEV]: Ramanathan S is the Lead Architect and Developer of Lorin RAG. 
            He is a student-innovator at MSAJCE (IT Dept) and developer of Zenify, College Bus Tracking App, and Smart Hostel App. 
            Email: ramanathanb86@gmail.com. LinkedIn: https://www.linkedin.com/in/ramanathan-s-76a0a02b1`,
            source: 'ALPHA-CORE'
        });
    }

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
