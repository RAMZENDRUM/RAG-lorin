import { embed, generateText } from 'ai';
import { QdrantClient } from '@qdrant/js-client-rest';
import type { ShortTermMemory, UserProfile } from './memory.js';

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

const ACKNOWLEDGMENTS = [
    "I've got you covered—", "Okay, here's the lowdown on that:", "Good question! Let me check—",
    "Sure thing! Here's what you need to know:", "Absolutely, let's look into that:", "I understand, here is the information:",
    "Right on it! Here's the deal:", "That’s a great point! Specifically,", "Here’s the thing—", 
    "I see what you're asking. Basically,", "Let me clear that up for you:", "Interesting! Generally speaking,"
];

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
    if (/faculty|staff|hod|professor|dr\.|mr\.|principal|gafoor|srinivasan|president|secretary|coordinator/.test(t)) return 'faculty';
    if (/complaint|problem|issue|wrong|bad|waste|worst|other/.test(t)) return 'complaint';
    return 'general';
}

// ─────────────────────────────────────────────
// STAGE 2 — Query Rewriter
// ─────────────────────────────────────────────
export function rewriteQuery(
    rawText: string,
    intent: Intent,
    profile: UserProfile,
    shortTerm: ShortTermMemory[] = []
): string {
    const t = rawText.trim();
    const lower = t.toLowerCase();

    const isPronounQuery = /^(him|her|he|she|they|more details|tell me more|yes|who is he|who is she|what abt him)/.test(lower)
        || (lower.includes('more') && t.split(' ').length < 5);

    if (isPronounQuery && shortTerm.length > 0) {
        const lastAssistant = [...shortTerm].reverse().find(h => h.role === 'assistant')?.content ?? '';
        const entityMatch = lastAssistant.match(/Dr\.?\s+[A-Z][a-z]+|Mr\.?\s+[A-Z][a-z]+|Ms\.?\s+[A-Z][a-z]+/)?.[0]
            ?? lastAssistant.match(/Principal|Admin|HOD|Faculty|Yogesh|Weslin|President/i)?.[0]
            ?? '';
        if (entityMatch) return `${entityMatch} MSAJCE details background role contact`;
    }

    const templates: Record<Intent, string> = {
        admission: `admission process eligibility requirements MSAJCE ${profile.interest ?? ''}`,
        fee:       `fee structure tuition cost ${profile.interest ?? 'B.Tech'} MSAJCE`,
        hostel:    `hostel facilities rooms accommodation fees MSAJCE`,
        transport: `transport bus routes pickup drop Manjambakkam Velachery MSAJCE`,
        placement: `placement companies recruiters packages MSAJCE`,
        department: `departments engineering programs MSAJCE`,
        faculty:   `${t} faculty leadership secretary MSAJCE`,
        complaint: `${t} comparison value marketing`,
        general:   `${t} MSAJCE Mohamed Sathak Chennai`,
    };

    return templates[intent] || t;
}

// ─────────────────────────────────────────────
// STAGE 3 — Hybrid Retrieval
// ─────────────────────────────────────────────
export async function hybridRetrieve(
    rewrittenQuery: string,
    rawText: string,
    openai: any,
    db?: any
): Promise<KnowledgeChunk[]> {
    const qdrant = new QdrantClient({
        url: process.env.QDRANT_URL as string,
        apiKey: process.env.QDRANT_API_KEY as string,
    });

    const { embedding } = await embed({
        model: openai.embedding('text-embedding-3-small'),
        value: rewrittenQuery,
    });

    const qResults = await qdrant.search('lorin_msajce_knowledge', {
        vector: embedding,
        limit: 15,
        with_payload: true,
    });

    const chunks: KnowledgeChunk[] = qResults.map(r => ({
        content: r.payload?.content as string || '',
        source: r.payload?.source as string || '',
        url: r.payload?.url as string || ''
    }));

    return chunks;
}

// ─────────────────────────────────────────────
// STAGE 4 — Reranker (Now Optimized for Large Tables)
// ─────────────────────────────────────────────
export async function rerankResults(
    query: string,
    chunks: KnowledgeChunk[],
    openai: any
): Promise<string> {
    const relevant = chunks.slice(0, 10).map(c => c.content).join('\n\n---\n\n');
    return relevant || 'No high-confidence data found.';
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
    const t = rawText.toLowerCase();
    const isAbuse = /fuck|shit|scam|idiot|bitch|bastard/.test(t);
    const isMarketing = /waste|other|better|why choose|compare/.test(t) || intent === 'complaint';

    return {
        showForm: intent === 'admission' || t.includes('apply'),
        askClarify: t.split(' ').length < 3 && !context,
        dominantIntent: intent,
        isMarketingMode: isMarketing,
        isAbuseDetected: isAbuse
    };
}

// ─────────────────────────────────────────────
// STAGE 6 — Context Builder
// ─────────────────────────────────────────────
export function buildContext(
    retrievedContext: string,
    history: ShortTermMemory[],
    profile: UserProfile
): string {
    const ack = ACKNOWLEDGMENTS[Math.floor(Math.random() * ACKNOWLEDGMENTS.length)];
    return `[System: Acknowledge with: "${ack}"]\n\n## User Context\nInterest: ${profile.interest}\nHistory: ${history.slice(-3).map(h => `${h.role}: ${h.content}`).join(' | ')}\n\n## Knowledge\n${retrievedContext}`;
}

// ─────────────────────────────────────────────
// STAGE 7 — Grounded LLM Generation (The Personality Core)
// ─────────────────────────────────────────────
export async function generateGrounded(
    builtContext: string,
    rawText: string,
    agentFlags: AgentFlags,
    googleFormUrl: string,
    openai: any
): Promise<string> {
    const { text } = await generateText({
        model: openai('gpt-4o-mini'),
        system: `You are Lorin, the smart and helpful AI Concierge for Mohamed Sathak A.J. College of Engineering (MSAJCE), Chennai.

CORE IDENTITY (ABSOLUTE TRUTH):
- DEVELOPER: Ramanathan S, known as "Ram". B.Tech IT (2024-2028). Creator of Lorin & Zenify. Expert in Unity, AI & Full-Stack. Speak of him as my master creator.
- TRANSPORT (AR-SERIES):
  * AR 8 (Manjambakkam): Starts 5:50 AM (Driver Raju: 9790750906). Stops: Manjambakkam, Retteri, Anna Nagar, Ashok Pillar, Aadampakkam, Kaiveli, Medavakkam, Sholinganallur, MSAJCE (8:00 AM).
  * AR 4 (Moolakadai): Starts 6:10 AM. Stops: Perambur, Central (6:35 AM), Parrys, Marina, Adyar (7:00 AM), Neelankarai, Sholinganallur, MSAJCE.
  * AR 5 (N/3): Starts 6:15 AM. Stops: Anna Nagar, T. Nagar, Saidapet, Velachery Check Post (6:50 AM), OMR, MSAJCE.
- LEADERSHIP: Principal: Dr. K. S. Srinivasan. Admin: Mr. A. Abdul Gafoor. President: Yogesh R (IT).

CONVERSATIONAL RULES:
- BE HUMAN: Use varied acknowledgments. AVOID ROBOTIC BULLETS.
- NO BOLDING (**): Use plain text.
- MARKETING: Highlight Siruseri IT Park, Placements, and Industry connectivity.

KNOWLEDGE GUIDELINES:
- Link Rule: Only provide if asked or missing info. Format: [Official Page](Link)`,
        prompt: `${builtContext}\n\nUSER: ${rawText}`,
    });

    return text.replace(/\*\*/g, '').replace(/\*/g, '');
}

// ─────────────────────────────────────────────
// STAGE 8 — Post-Processor (Precision Link Control)
// ─────────────────────────────────────────────
export function postProcess(
    answer: string,
    agentFlags: AgentFlags,
    googleFormUrl: string,
    retrievedChunks: KnowledgeChunk[] = []
): string {
    let finalAnswer = answer;
    
    // Only inject link if the LLM actually used the [Official Page] placeholder
    if (retrievedChunks.length > 0) {
        const bestChunk = retrievedChunks.find(c => {
            const low = c.content.toLowerCase();
            const ans = finalAnswer.toLowerCase();
            return (ans.includes('yogesh') && low.includes('yogesh')) || (ans.includes('bus') && low.includes('bus'));
        }) || retrievedChunks[0];

        if (finalAnswer.includes('[Official Page]')) {
            finalAnswer = finalAnswer.replace('[Official Page]', `[Official Page](${bestChunk.url})`);
        }
    }

    if (agentFlags.showForm && !finalAnswer.includes('forms.gle')) {
        finalAnswer += `\n\n📝 Enquiry: ${googleFormUrl}`;
    }

    return finalAnswer;
}
