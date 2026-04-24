/**
 * Lorin v2 — 9-Stage Orchestrated Intelligence Pipeline
 * Each stage is a pure, named function. No global state.
 */

import { embed, generateText } from 'ai';
import { QdrantClient } from '@qdrant/js-client-rest';
import type { ShortTermMemory, UserProfile } from './memory.js';

// ─────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────
export type Intent =
    | 'admission'
    | 'faculty'
    | 'department'
    | 'hostel'
    | 'transport'
    | 'fee'
    | 'placement'
    | 'complaint'
    | 'general';

export interface AgentFlags {
    showForm: boolean;
    askClarify: boolean;
    dominantIntent: Intent;
}

export interface OrchestratorInput {
    rawText: string;
    userId: string;
    shortTerm: ShortTermMemory[];
    profile: UserProfile;
    db: any;
    openai: any;
    lastFormTime: number;
    googleFormUrl: string;
}

export interface OrchestratorOutput {
    finalReply: string;
    intent: Intent;
    retrievedContext: string;
}

// ─────────────────────────────────────────────
// STAGE 1 — Intent Classifier
// ─────────────────────────────────────────────
export function classifyIntent(text: string): Intent {
    const t = text.toLowerCase();
    if (/admiss|join|apply|enrol|seat|cutoff|counsell/.test(t)) return 'admission';
    if (/fee|fees|cost|tuition|payment/.test(t)) return 'fee';
    if (/hostel|room|accommo|stay|pg/.test(t)) return 'hostel';
    if (/transport|bus|route|pick.?up|drop/.test(t)) return 'transport';
    if (/place|recruit|company|package|salary|job/.test(t)) return 'placement';
    if (/department|dept|cse|it|ece|eee|mech|civil|ai|cyber|csbs/.test(t)) return 'department';
    if (/faculty|staff|hod|professor|dr\.|mr\.|principal|gafoor|srinivasan/.test(t)) return 'faculty';
    if (/complaint|problem|issue|wrong|bad/.test(t)) return 'complaint';
    return 'general';
}

// ─────────────────────────────────────────────
// STAGE 2 — Query Rewriter
// Expands vague queries into rich search queries
// ─────────────────────────────────────────────
export function rewriteQuery(
    rawText: string,
    intent: Intent,
    profile: UserProfile,
    shortTerm: ShortTermMemory[] = []
): string {
    const t = rawText.trim();
    const lower = t.toLowerCase();

    // --- Pronoun Resolution ---
    // If query uses 'him/her/he/she/more details/tell me more' with no subject,
    // extract the last named subject from history
    const isPronounQuery = /^(him|her|he|she|they|more details|tell me more|yes|who is he|who is she|what abt him)/.test(lower)
        || (lower.includes('more') && t.split(' ').length < 5);

    if (isPronounQuery && shortTerm.length > 0) {
        const lastAssistant = [...shortTerm].reverse().find(h => h.role === 'assistant')?.content ?? '';
        // Pull out named entities from last reply to anchor the search
        const entityMatch = lastAssistant.match(/Dr\.?\s+[A-Z][a-z]+|Mr\.?\s+[A-Z][a-z]+|Ms\.?\s+[A-Z][a-z]+/)?.[0]
            ?? lastAssistant.match(/Principal|Admin|HOD|Faculty/i)?.[0]
            ?? '';
        if (entityMatch) {
            return `${entityMatch} MSAJCE details background role contact`;
        }
    }

    // Already detailed enough
    if (t.split(' ').length > 6) return t;

    const templates: Record<Intent, string> = {
        admission: `admission process eligibility requirements MSAJCE Chennai ${profile.interest ?? ''}`,
        fee:       `fee structure tuition cost ${profile.interest ?? 'B.Tech'} MSAJCE Chennai`,
        hostel:    `hostel facilities rooms accommodation fees MSAJCE Chennai`,
        transport: `transport bus routes pickup drop MSAJCE Chennai`,
        placement: `placement companies packages recruiters MSAJCE Chennai ${profile.interest ?? ''}`,
        department: `departments engineering programs offered MSAJCE Chennai`,
        faculty:   `${t} faculty staff MSAJCE Chennai`,
        complaint: `${t}`,
        general:   `${t} MSAJCE Mohamed Sathak Chennai`,
    };

    return templates[intent] || t;
}

// ─────────────────────────────────────────────
// STAGE 4 — Hybrid Retrieval (Vector + Keyword)
// Returns raw chunk array for reranking
// ─────────────────────────────────────────────
export async function hybridRetrieve(
    rewrittenQuery: string,
    rawText: string,
    openai: any,
    db: any
): Promise<string[]> {
    const qdrant = new QdrantClient({
        url: process.env.QDRANT_URL as string,
        apiKey: process.env.QDRANT_API_KEY as string,
    });

    const { embedding } = await embed({
        model: openai.embedding('text-embedding-3-small'),
        value: rewrittenQuery,
    });

    // Vector search — cast wide net (15 chunks for reranker to filter)
    const qResults = await qdrant.search('lorin_msajce_knowledge', {
        vector: embedding,
        limit: 15,
        with_payload: true,
    });

    const chunks: string[] = (qResults.map(r => r.payload?.content ?? '').filter(Boolean)) as string[];

    // Keyword search priority — prepend exact-match hits
    if (db && rawText.split(' ').length <= 5) {
        const kResults = await db`
            SELECT content FROM lorin_knowledge
            WHERE content ILIKE ${'%' + rawText + '%'}
            LIMIT 4
        `;
        const kChunks: string[] = kResults.map((r: any) => r.content);
        // Deduplicate and prepend keyword hits
        kChunks.forEach(k => { if (!chunks.includes(k)) chunks.unshift(k); });
    }

    return chunks.length > 0 ? chunks : ['No data found.'];
}

// ─────────────────────────────────────────────
// STAGE 4.5 — LLM Reranker (via Vercel AI Key)
// Scores chunk previews, keeps top 5 full chunks
// Cost: ~200 tokens. Saves ~800 tokens main call.
// ─────────────────────────────────────────────
export async function rerankResults(
    query: string,
    chunks: string[],
    openai: any
): Promise<string> {
    // Skip if too few chunks to bother
    if (chunks.length <= 3 || chunks[0] === 'No data found.') {
        return chunks.join('\n\n---\n\n');
    }

    try {
        // Build a compact preview list — keep tokens low
        const previews = chunks
            .map((c, i) => `[${i}]: ${c.substring(0, 180).replace(/\n/g, ' ')}`)
            .join('\n');

        const { text } = await generateText({
            model: openai('gpt-4o-mini'),
            maxOutputTokens: 20,
            prompt: `You are a relevance scorer for a college knowledge base.
Query: "${query}"

Chunks:
${previews}

Return ONLY the 0-based indices of the top 5 most relevant chunks, comma-separated. Example: 2,0,7,3,11`,
        });

        const indices = text
            .trim()
            .split(',')
            .map(s => parseInt(s.trim()))
            .filter(i => !isNaN(i) && i >= 0 && i < chunks.length)
            .slice(0, 5);

        if (indices.length === 0) throw new Error('No valid indices returned');

        const reranked = indices.map(i => chunks[i]);
        console.log(`[Reranker] ${chunks.length} chunks → top ${reranked.length} selected via LLM`);
        return reranked.join('\n\n---\n\n');

    } catch (e: any) {
        console.warn('[Reranker] Fallback to top-5:', e.message);
        return chunks.slice(0, 5).join('\n\n---\n\n');
    }
}

// ─────────────────────────────────────────────
// STAGE 5 — Agent Decider
// ─────────────────────────────────────────────
export function agentDecide(
    intent: Intent,
    rawText: string,
    retrievedContext: string,
    lastFormTime: number,
    googleFormUrl: string
): AgentFlags {
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    const isForce = /give me|send|where is|link|form url/i.test(rawText);
    const cooldownActive = lastFormTime > oneHourAgo;

    const showForm =
        (intent === 'admission' || intent === 'fee') &&
        !retrievedContext.includes(googleFormUrl) &&
        (!cooldownActive || isForce);

    // Ask for clarification only on vague single-word queries with no useful context
    const askClarify =
        rawText.trim().split(' ').length === 1 &&
        retrievedContext === 'No data found.';

    return { showForm, askClarify, dominantIntent: intent };
}

// ─────────────────────────────────────────────
// STAGE 6 — Context Builder
// Assembles a clean, structured prompt block
// ─────────────────────────────────────────────
export function buildContext(
    retrievedContext: string,
    shortTerm: ShortTermMemory[],
    profile: UserProfile
): string {
    const memoryBlock = shortTerm.length
        ? `## Conversation History\n${shortTerm.map(h => `${h.role.toUpperCase()}: ${h.content}`).join('\n')}`
        : '';

    const profileBlock = profile.interest
        ? `## User Profile\nKnown Interest: ${profile.interest} | Stage: ${profile.stage}`
        : '';

    const dataBlock = `## Campus Knowledge\n${retrievedContext}`;

    return [profileBlock, memoryBlock, dataBlock].filter(Boolean).join('\n\n');
}

// ─────────────────────────────────────────────
// STAGE 7 — Grounded LLM Generation
// ─────────────────────────────────────────────
export async function generateGrounded(
    builtContext: string,
    rawText: string,
    agentFlags: AgentFlags,
    googleFormUrl: string,
    openai: any
): Promise<string> {
    const clarifyInstruction = agentFlags.askClarify
        ? 'The user query is too vague. Ask ONE friendly clarifying question instead of guessing.'
        : '';

    const { text } = await generateText({
        model: openai('gpt-4o-mini'),
        system: `You are Lorin, the friendly AI Concierge for Mohamed Sathak A.J. College of Engineering, Siruseri, Chennai.

IDENTITY (never change these):
- College: Mohamed Sathak A.J. College of Engineering, Chennai ONLY
- Principal: Dr. K. S. Srinivasan, Optics specialist, NIT Trichy alumnus, Phone: 9150575066, Email: principal@msajce-edu.in
- Admin: Mr. A. Abdul Gafoor, Assistant Transport Convener and Administrative Officer, Phone: 99403 19629
- Programs Offered (UG): Civil, CSE, IT, EEE, ECE, Mechanical, AI&DS, AI&ML, Cyber Security, CSBS, ECE(VLSI), ECE(ACT). (Always list ALL of these accurately if asked).

FORMATTING RULES (critical):
- NEVER use #, ##, ###, *, ** or _ symbols. Plain text only.
- Use bullet points with the - character or just numbers like 1. 2. 3.
- Do NOT always jump straight into structured bullet answers. Use a mix of short paragraphs and natural flow.
- Avoid over-formatting. Keep responses short, warm, and conversational.
- Use emojis naturally, but do not overdo it.
- Never say Welcome more than once per session.
- Never repeat content already given in the conversation history.

CONVERSATIONAL INTERACTION LAYER:
- Use varied, natural acknowledgments when appropriate (e.g., "I understand", "Good question", "Okay,"). Do NOT keep repeating the same phrase like "Got it—".
- Add small natural phrases (e.g., "Here's the thing—", "The key point is—"). Do not overuse fillers. Rotate them so you do not sound robotic.
- Responses should feel like an ongoing conversation, not a standalone output. Avoid robotic structures.
- Gently guide the user forward (suggest a next step or ask a simple follow-up), but do NOT ask unnecessary questions.

MARKETING PERSUASION MODE:
- If the user says the college is "waste", "other is better", or asks "why should I choose this college?", switch to Marketing Agent Mode.
- Respond confidently and positively. Speak like a smart admission counselor, not defensive.
- Highlight strengths: Siruseri IT Park location constraint, placement opportunities, facilities, industry exposure.
- Do NOT insult competing colleges. Do NOT argue emotionally. Redirect to MSAJCE strengths.

ADAPTIVE LANGUAGE STYLE:
- Dynamically match the user's English proficiency (Basic/Intermediate/Advanced) and tone.
- Basic (A2-B1): Use simple words, short sentences. Avoid jargon. Be clear and direct.
- Intermediate (B1-B2): Natural, slightly richer vocabulary, clear explanations.
- Advanced (C1-C2): Precise vocabulary, structured explanations, technical depth allowed.
- Prioritize clarity over complexity. Do not oversimplify if advanced or overcomplicate if basic.
- If user mixes styles, default to simpler. If unsure, assume Intermediate.

ACCURACY (STRICT KNOWLEDGE GROUNDING):
- Answer ONLY using the information provided in the Campus Knowledge section below.
- Do NOT hallucinate or invent your own words, details, phone numbers, or fees.
- If the user asks for "more details" but there is no more information in your context, DO NOT REPEAT the same details. Gracefully inform them: "I am an AI assistant restricted to the official college database. That's all the info I currently have available about this topic. You can contact the admin directly for more details."
- NEVER use any other form link except: ${googleFormUrl}

${clarifyInstruction}`,
        prompt: builtContext + `\n\nUSER: ${rawText}`,
    });

    return text;
}

// ─────────────────────────────────────────────
// STAGE 8 — Post-Processor
// Injects form link if agentFlags call for it
// ─────────────────────────────────────────────
export function postProcess(
    answer: string,
    agentFlags: AgentFlags,
    googleFormUrl: string
): string {
    if (agentFlags.showForm && !answer.includes('forms.gle')) {
        return answer + `\n\nReady to apply? Fill the admission enquiry form here: ${googleFormUrl}`;
    }
    return answer;
}
