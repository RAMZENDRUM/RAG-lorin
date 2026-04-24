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
// STAGE 3 — Hybrid Retrieval (Qdrant + Keyword)
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

    // Vector search
    const qResults = await qdrant.search('lorin_msajce_knowledge', {
        vector: embedding,
        limit: 15,
        with_payload: true,
    });

    const chunks: KnowledgeChunk[] = qResults.map(r => ({
        content: r.payload?.content as string || '',
        source: r.payload?.source as string || 'index.txt'
    })).filter(c => c.content);

    // Keyword search fallback
    if (db && rawText.split(' ').length <= 5) {
        const kResults = await db`
            SELECT content, metadata FROM lorin_knowledge
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
    chunks: KnowledgeChunk[],
    openai: any
): Promise<string> {
    if (chunks.length <= 3 || chunks[0].content === 'No data found.') {
        return chunks.map(c => c.content).join('\n\n---\n\n');
    }

    try {
        const previews = chunks
            .map((c, i) => `[${i}]: ${c.content.substring(0, 180).replace(/\n/g, ' ')}`)
            .join('\n');

        const { text: indicesText } = await generateText({
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
- Developer (Ram): Ramanathan S, B.Tech IT student at MSAJCE. LinkedIn: https://www.linkedin.com/in/ramanathan-s-it. His portfolio: https://ramanathan-portfolio.vercel.app
- Ram's Key Projects: Zenify (Premium music player like Spotify), Lorin (This AI Bot), Pocket Lawyer, College Bus Tracking App, Smart Hostel Web App, Event Management System, and Haunted Village (Unity Game). NEVER mention his CGPA or academic scores.
- Programs Offered (UG): Civil, CSE, IT, EEE, ECE, Mechanical, AI&DS, AI&ML, Cyber Security, CSBS, ECE(VLSI), ECE(ACT).

FORMATTING RULES (critical):
- COMPLETELY BAN MARKDOWN BOLDING (**).
- STRUCTURE: Use bullet points (like - or 1. 2.) for ALMOST ALL of your answers. Parents and students skim messages, so avoid long paragraphs entirely. Give your detailed info as clean, spaced bullet lists with punchy highlights.
- EMOJIS: Use emojis moderately (about 10% to 30% of the response) to make it friendly. However, DO NOT use any emojis if the user's question or topic is serious, critical, or sensitive.
- Avoid over-formatting. Keep responses short, warm, and conversational.
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
- If the user asks for "more details" but your context does not contain any more comprehensive data, DO NOT mechanically repeat what you already said.
- Instead, gracefully say: "I don't have much more detailed information on this right now. You can check out the official page for more accurate details: [Link]".
- You must derive the [Link] from the 'Source' file listed in your data chunks (e.g., if Source is 'principal.txt', the link is 'https://www.msajce-edu.in/principal.php'). 
- ONLY use this "check out the page" out-link fallback when you legitimately lack data. Do NOT provide links for every message.
- LOCATION LINK: If the user asks about the college location, campus visits, or admissions directly related to reaching the campus specifically for MSAJCE (Mohamed Sathak A.J. College of Engineering), ALWAYS provide this Google Maps link: https://maps.app.goo.gl/a4WfXLXHzszjZ6Bv9
- NEVER provide the above Maps link if they ask about Mohamed Sathak A.J. College of Nursing, Arts colleges, or any other institutions/sister colleges.
- TRANSPORT RULES: If the user asks how to reach the campus, explicitly state that College Buses are strictly for enrolled students only. Parents, new admissions, and visitors must come via their own vehicles, MTC public buses, autos, or cabs.
- NEVER use any other form link except: ${googleFormUrl}

${clarifyInstruction}`,
        prompt: builtContext + `\n\nUSER: ${rawText}`,
    });

    // Physically vaporize stubborn markdown asterisks/hashes the LLM might hallucinate
    const cleanedText = text
        .replace(/\*\*/g, '') // Remove double asterisks
        .replace(/\*/g, '')   // Remove single asterisks
        .replace(/### /g, '') // Remove H3
        .replace(/## /g, '')  // Remove H2
        .replace(/# /g, '');  // Remove H1

    return cleanedText;
}

// ─────────────────────────────────────────────
// STAGE 8 — Post-Processor (Systematic Link Injection)
// ─────────────────────────────────────────────
export function postProcess(
    answer: string,
    agentFlags: AgentFlags,
    googleFormUrl: string,
    retrievedChunks: any[] = []
): string {
    let finalAnswer = answer;

    // 1. Resolve source link from the best chunk
    if (retrievedChunks.length > 0 && retrievedChunks[0].source) {
        const sourceMap: Record<string, string> = {
            'index.txt': 'https://www.msajce-edu.in/',
            'about.txt': 'https://www.msajce-edu.in/about.php',
            'admission.txt': 'https://www.msajce-edu.in/admission.php',
            'infrastructure.txt': 'https://www.msajce-edu.in/infrastructure.php',
            'hostel.txt': 'https://www.msajce-edu.in/hostel.php',
            'transport.txt': 'https://www.msajce-edu.in/transport.php',
            'principal.txt': 'https://www.msajce-edu.in/principal.php',
            'placement.txt': 'https://www.msajce-edu.in/placement.php',
            'departments.txt': 'https://www.msajce-edu.in/departments.php'
        };

        const sourceFile = retrievedChunks[0].source;
        const realLink = sourceMap[sourceFile] || `https://www.msajce-edu.in/${sourceFile.replace('.txt', '.php')}`;

        // If the LLM mentions "official page" or "link", replace the text or append
        if (finalAnswer.includes('official page') || finalAnswer.includes('Link')) {
            finalAnswer = finalAnswer.replace(/Link|\[Link\]/g, realLink);
            if (!finalAnswer.includes(realLink)) {
                finalAnswer += `\n\n🔗 Source: ${realLink}`;
            }
        }
    }

    // 2. Inject Admission Form
    if (agentFlags.showForm && !finalAnswer.includes('forms.gle')) {
        finalAnswer += `\n\nReady to apply? Fill the admission enquiry form here: ${googleFormUrl}`;
    }

    return finalAnswer;
}
