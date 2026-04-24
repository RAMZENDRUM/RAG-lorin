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

export interface KnowledgeChunk {
    content: string;
    source: string;
    url?: string;
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
    if (/faculty|staff|hod|professor|dr\.|mr\.|principal|gafoor|srinivasan|president|secretary|coordinator/.test(t)) return 'faculty';
    if (/complaint|problem|issue|wrong|bad/.test(t)) return 'complaint';
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

    // Pronoun Resolution
    const isPronounQuery = /^(him|her|he|she|they|more details|tell me more|yes|who is he|who is she|what abt him)/.test(lower)
        || (lower.includes('more') && t.split(' ').length < 5);

    if (isPronounQuery && shortTerm.length > 0) {
        const lastAssistant = [...shortTerm].reverse().find(h => h.role === 'assistant')?.content ?? '';
        const entityMatch = lastAssistant.match(/Dr\.?\s+[A-Z][a-z]+|Mr\.?\s+[A-Z][a-z]+|Ms\.?\s+[A-Z][a-z]+/)?.[0]
            ?? lastAssistant.match(/Principal|Admin|HOD|Faculty|Yogesh|Weslin|President/i)?.[0]
            ?? '';
        if (entityMatch) {
            return `${entityMatch} MSAJCE details background role contact`;
        }
    }

    if (t.split(' ').length > 6) return t;

    const templates: Record<Intent, string> = {
        admission: `admission process eligibility requirements MSAJCE Chennai ${profile.interest ?? ''}`,
        fee:       `fee structure tuition cost ${profile.interest ?? 'B.Tech'} MSAJCE Chennai`,
        hostel:    `hostel facilities rooms accommodation fees MSAJCE Chennai`,
        transport: `transport bus routes pickup drop MSAJCE Chennai`,
        placement: `placement companies packages recruiters MSAJCE Chennai ${profile.interest ?? ''}`,
        department: `departments engineering programs offered MSAJCE Chennai`,
        faculty:   `${t} faculty staff leadership coordinator MSAJCE Chennai`,
        complaint: `${t}`,
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
        limit: 12,
        with_payload: true,
    });

    const chunks: KnowledgeChunk[] = qResults.map(r => ({
        content: r.payload?.content as string || '',
        source: r.payload?.source as string || '',
        url: r.payload?.url as string || ''
    })).filter(c => c.content);

    // Keyword hits
    if (db && rawText.split(' ').length <= 6) {
        const kResults = await db`
            SELECT content, metadata FROM lorin_knowledge
            WHERE content ILIKE ${'%' + rawText + '%'}
            LIMIT 4
        `;
        
        kResults.forEach((r: any) => {
            const exists = chunks.some(c => c.content === r.content);
            if (!exists) {
                chunks.unshift({
                    content: r.content,
                    source: r.metadata.source,
                    url: r.metadata.url
                });
            }
        });
    }

    return chunks.length > 0 ? chunks : [{ content: 'No data found.', source: '' }];
}

// ─────────────────────────────────────────────
// STAGE 4 — Reranker
// ─────────────────────────────────────────────
export async function rerankResults(
    query: string,
    chunks: KnowledgeChunk[],
    openai: any
): Promise<string> {
    if (chunks.length <= 4 || chunks[0].content === 'No data found.') {
        return chunks.map(c => c.content).join('\n\n---\n\n');
    }
    // Simple top-6 cut for speed, context window is large enough for 1000-char chunks
    return chunks.slice(0, 8).map(c => c.content).join('\n\n---\n\n');
}

// ─────────────────────────────────────────────
// STAGE 5 — Agent Decision Logic
// ─────────────────────────────────────────────
export function agentDecide(
    intent: Intent,
    rawText: string,
    context: string,
    lastSeen: number,
    googleFormUrl: string
): AgentFlags {
    const isHighIntent = intent === 'admission' || /apply|join|enquiry|seat/.test(rawText.toLowerCase());
    return {
        showForm: isHighIntent,
        askClarify: rawText.split(' ').length < 3 && !context,
        dominantIntent: intent
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
    const profileBlock = profile.interest ? `## User Interest\n- Student interested in: ${profile.interest}` : '';
    const memoryBlock = history.length > 0 ? `## Past Conversation\n${history.map(h => `${h.role}: ${h.content}`).join('\n')}` : '';
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
    const { text } = await generateText({
        model: openai('gpt-4o-mini'),
        system: `You are Lorin, the smart AI Concierge for Mohamed Sathak A.J. College of Engineering (MSAJCE).

IDENTITY & LEADERSHIP (Ground Truth):
- Principal: Dr. K. S. Srinivasan
- Administrative Officer: Mr. A. Abdul Gafoor
- CSI President (Student): Yogesh R (IT Dept, 2022-2026 Batch)
- CSI Counselor (Faculty): Dr. D. Weslin (Associate Professor, IT)
- CSI Vice President: Saqlin Mustaq M (AI&DS)
- Fine Arts President: Kishore. P (Mechanical)
- Developer: Ramanathan S (B.Tech IT), known as "Ram".

Rules:
- NEVER use double asterisks (**) or markdown bolding.
- Use Bullet points for details.
- Be friendly but professional.
- If you lack specific data, provide the source link using the format: [Official Page](Link)
- LINK FALLBACK: If providing a link, derive it from the knowledge context provided.

${agentFlags.askClarify ? 'Query is vague. Ask for clarification.' : ''}`,
        prompt: builtContext + `\n\nUSER: ${rawText}`,
    });

    return text.replace(/\*\*/g, '').replace(/\*/g, '');
}

// ─────────────────────────────────────────────
// STAGE 8 — Post-Processor (Smart Link Injection)
// ─────────────────────────────────────────────
export function postProcess(
    answer: string,
    agentFlags: AgentFlags,
    googleFormUrl: string,
    retrievedChunks: KnowledgeChunk[] = []
): string {
    let finalAnswer = answer;
    
    // 1. Resolve highly relevant source link
    if (retrievedChunks.length > 0) {
        // Find the BEST chunk that actually contains the answer's key subject
        const bestChunk = retrievedChunks.find(c => {
            const content = c.content.toLowerCase();
            const ans = finalAnswer.toLowerCase();
            return (ans.includes('yogesh') && content.includes('yogesh')) ||
                   (ans.includes('srinivasan') && content.includes('srinivasan')) ||
                   (ans.includes('bus') && content.includes('bus')) ||
                   (ans.includes('hostel') && content.includes('hostel'));
        }) || retrievedChunks[0];

        const realLink = bestChunk.url;
        
        // Only inject link if the LLM mentions "Official Page", "Link", "Source",
        // OR if the answer is very short and lacks details.
        const needsLink = /official page|link|source|website/i.test(finalAnswer) || finalAnswer.length < 200;

        if (realLink && needsLink && !finalAnswer.includes('http')) {
            // Replace [Link] placeholder or append gracefully
            if (finalAnswer.includes('[Official Page]')) {
                finalAnswer = finalAnswer.replace('[Official Page]', `[Official Page](${realLink})`);
            } else {
                finalAnswer += `\n\n🔗 Source: ${realLink}`;
            }
        }
    }

    // 2. Inject Admission Form (only if relevant)
    if (agentFlags.showForm && !finalAnswer.includes('forms.gle')) {
        finalAnswer += `\n\n📝 Admission Enquiry: ${googleFormUrl}`;
    }

    return finalAnswer;
}
