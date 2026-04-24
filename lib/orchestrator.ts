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
export function rewriteQuery(rawText: string, intent: Intent, profile: UserProfile): string {
    const t = rawText.trim();

    // Already detailed enough
    if (t.split(' ').length > 6) return t;

    const templates: Record<Intent, string> = {
        admission: `admission process eligibility requirements documents MSAJCE Chennai ${profile.interest ?? ''}`,
        fee:       `fee structure tuition cost ${profile.interest ?? 'B.Tech'} MSAJCE Chennai`,
        hostel:    `hostel facilities rooms accommodation fees MSAJCE Chennai`,
        transport: `transport bus routes pickup drop MSAJCE Chennai`,
        placement: `placement companies packages recruiters MSAJCE Chennai ${profile.interest ?? ''}`,
        department:`departments offered engineering programs MSAJCE Chennai`,
        faculty:   `${t} faculty staff MSAJCE Chennai`,
        complaint: `${t}`,
        general:   `${t} MSAJCE Mohamed Sathak Chennai`,
    };

    return templates[intent] || t;
}

// ─────────────────────────────────────────────
// STAGE 4 — Hybrid Retrieval (Vector + Keyword)
// ─────────────────────────────────────────────
export async function hybridRetrieve(
    rewrittenQuery: string,
    rawText: string,
    openai: any,
    db: any
): Promise<string> {
    const qdrant = new QdrantClient({
        url: process.env.QDRANT_URL as string,
        apiKey: process.env.QDRANT_API_KEY as string,
    });

    const { embedding } = await embed({
        model: openai.embedding('text-embedding-3-small'),
        value: rewrittenQuery,
    });

    // Vector search (semantic concepts)
    const qResults = await qdrant.search('lorin_msajce_knowledge', {
        vector: embedding,
        limit: 12,
        with_payload: true,
    });

    // Keyword search (exact names / short queries)
    let keywordContext = '';
    if (db && rawText.split(' ').length <= 5) {
        const kResults = await db`
            SELECT content FROM lorin_knowledge
            WHERE content ILIKE ${'%' + rawText + '%'}
            LIMIT 4
        `;
        keywordContext = kResults.map((r: any) => r.content).join('\n\n');
    }

    const vectorContext = qResults.map(r => r.payload?.content ?? '').join('\n\n');

    // Keyword hits get priority (exact match = higher signal)
    return [keywordContext, vectorContext].filter(Boolean).join('\n\n---\n\n') || 'No data found.';
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
        system: `You are Lorin 🎓, the lively and intelligent AI Concierge for Mohamed Sathak A.J. College of Engineering, Siruseri, Chennai.

STRICT IDENTITY:
- College: Mohamed Sathak A.J. College of Engineering (Chennai) ONLY. Never mention Kilakarai or any other college.
- Principal: Dr. K. S. Srinivasan (Optics specialist, NIT Trichy alumnus)
- Admin: Mr. A. Abdul Gafoor (Assistant Transport Convener & Administrative Officer)

PERSONALITY:
- Warm, friendly campus buddy — like a senior student helping a junior.
- Use emojis naturally. Keep responses concise and direct.
- Greet only on first message. Never say "Welcome" again after that.
- If user already answered a question, do NOT ask it again.

ACCURACY RULES:
- Answer ONLY from the Campus Knowledge in the context below.
- Do NOT hallucinate. If data is missing, say "I don't have that info right now — contact the office directly!"
- If a person's name is in the Campus Knowledge, identify them precisely.
- NEVER mention any other Google Form or link except: ${googleFormUrl}

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
        return answer + `\n\n📝 **Ready to apply? Fill the admission enquiry form:**\n${googleFormUrl}`;
    }
    return answer;
}
