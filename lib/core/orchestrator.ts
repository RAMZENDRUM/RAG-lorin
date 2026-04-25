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

const HARD_LINK_MAP: Record<string, string> = {
    "principal": "https://www.msajce-edu.in/principal.php",
    "admin": "https://www.msajce-edu.in/administration.php",
    "governing council": "https://www.msajce-edu.in/governingcouncil.php",
    "transport": "https://www.msajce-edu.in/transport.php",
    "placement": "https://www.msajce-edu.in/placement.php",
    "it": "https://www.msajce-edu.in/it.php",
    "cse": "https://www.msajce-edu.in/cse.php",
    "aids": "https://www.msajce-edu.in/aids.php",
    "aiml": "https://www.msajce-edu.in/aiml.php",
    "cyber": "https://www.msajce-edu.in/cyber.php",
    "csbs": "https://www.msajce-edu.in/csbs.php"
};

// No robotic filler acknowledgments allowed.

// ─────────────────────────────────────────────
// STAGE 1 — Intent Classifier
// ─────────────────────────────────────────────
export function classifyIntent(text: string): Intent {
    const t = text.toLowerCase();
    
    // Explicit Identity Detection (Highest Priority)
    if (/(who|tell|about|contact|info|details|profile|is|the)\s+(dr|mr|ms|mrs|prof)?\.?\s*[a-z]+/.test(t)) return 'faculty';
    if (/faculty|staff|hod|professor|dr\.|mr\.|principal|gafoor|srinivasan|president|secretary|coordinator/.test(t)) return 'faculty';

    if (/admiss|join|apply|enrol|seat|cutoff|counsell/.test(t)) return 'admission';
    if (/fee|fees|cost|tuition|payment/.test(t)) return 'fee';
    if (/hostel|room|accommo|stay|pg/.test(t)) return 'hostel';
    if (/transport|bus|route|pick.?up|drop/.test(t)) return 'transport';
    if (/place|recruit|company|package|salary|job/.test(t)) return 'placement';
    if (/department|dept|cse|it|ece|eee|mech|civil|ai|cyber|csbs/.test(t)) return 'department';
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
            ?? lastAssistant.match(/Principal|Admin|HOD|Faculty|Yogesh|Weslin|Usha|President/i)?.[0]
            ?? '';
        
        if (entityMatch) {
            // Check if we've already given the basic summary to avoid loops
            const isRepeating = /role|position|vision|experience/i.test(lastAssistant);
            if (isRepeating) {
                return `${entityMatch} MSAJCE specific research initiatives department contact credentials projects`;
            }
            return `${entityMatch} MSAJCE details background role contact biography`;
        }
    }

    const templates: Record<Intent, string> = {
        admission: `admission process eligibility requirements MSAJCE ${profile.interest ?? ''}`,
        fee:       `fee structure tuition cost ${profile.interest ?? 'B.Tech'} MSAJCE`,
        hostel:    `hostel facilities rooms accommodation fees MSAJCE`,
        transport: `transport bus routes pickup drop Manjambakkam Velachery MSAJCE`,
        placement: `placement companies recruiters packages MSAJCE`,
        department: `departments engineering programs MSAJCE`,
        faculty:   `${t} personnel MSAJCE`,
        complaint: `${t} comparison value marketing`,
        general:   `${t} MSAJCE college info`,
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
    db?: any,
    limit: number = 15
): Promise<KnowledgeChunk[]> {
    // STAGE 1: Supabase Entity Lookup (Fuzzy Priority)
    let entityContext = "";
    try {
        const sql = db; 
        if (sql) {
            const rawQueryClean = rewrittenQuery.replace(/who|is|the|msajce|personnel|about|tell/gi, '').trim();
            const tokens = rawQueryClean.split(' ').filter(t => t.length > 2);
            if (tokens.length > 0) {
                // Search for ALL variations + specific owner boost
                const results = await sql`
                    SELECT name, role, department, batch, context, 
                    CASE 
                        WHEN role ILIKE '%Developer%' OR name ILIKE '%Ramanathan%' THEN similarity(name, ${rawQueryClean}) + 0.5
                        WHEN role ILIKE '%AR-%' OR role ILIKE '%R-%' THEN similarity(name, ${rawQueryClean}) + 0.3
                        ELSE similarity(name, ${rawQueryClean}) 
                    END as score
                    FROM msajce_entities 
                    WHERE name % ${rawQueryClean} 
                    OR name ILIKE ${'%' + tokens.join('%') + '%'}
                    OR role ILIKE ${'%' + tokens.join('%') + '%'}
                    OR context ILIKE ANY (${tokens.map(t => '%' + t + '%')})
                    ORDER BY score DESC
                    LIMIT 5
                `;
                
                if (results && results.length > 0) {
                    entityContext = results.map((r: any) => {
                        const isOwner = r.role?.toLowerCase().includes('developer');
                        const isCollegeBus = r.role?.toLowerCase().includes('ar-') || r.role?.toLowerCase().includes('r-');
                        const isStudent = r.batch || r.role?.toLowerCase().includes('student') || r.role?.toLowerCase().includes('president') || r.role?.toLowerCase().includes('secretary');
                        const label = isOwner ? '[OWNER/DEVELOPER ENTITY]' : (isCollegeBus ? '[COLLEGE BUS ENTITY]' : (isStudent ? '[STUDENT ENTITY]' : '[FACULTY/OFFICIAL ENTITY]'));
                        return `${label}: Name: ${r.name} | Role: ${r.role} | Dept: ${r.department} | Batch: ${r.batch} | Context: ${r.context}`;
                    }).join('\n\n');
                }
            }
        }
    } catch (e) { console.error('Fuzzy Entity Lookup Failed:', e); }

    // STAGE 2: Qdrant Search
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
        limit: limit,
        with_payload: true,
    });

    const chunks: KnowledgeChunk[] = qResults.map(r => ({
        content: r.payload?.content as string || '',
        source: r.payload?.source as string || '',
        url: r.payload?.url as string || ''
    }));

    // Prepend Entity Context if found
    if (entityContext) {
        chunks.unshift({
            content: entityContext,
            source: 'Supabase Entity Store',
            url: 'https://www.msajce-edu.in'
        });
    }

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
    const rawQuery = query.toLowerCase();
    
    // Extract potential names from query (simple heuristic)
    const nameKeywords = query.split(' ').filter(w => w.length > 3 && !['who', 'is', 'the', 'msajce', 'personnel', 'about', 'tell'].includes(w.toLowerCase()));

    // Sort by name presence first
    const sorted = [...chunks].sort((a, b) => {
        let scoreA = 0;
        let scoreB = 0;
        const lowA = a.content.toLowerCase();
        const lowB = b.content.toLowerCase();

        for (const kw of nameKeywords) {
            if (lowA.includes(kw.toLowerCase())) scoreA += 10;
            if (lowB.includes(kw.toLowerCase())) scoreB += 10;
        }

        return scoreB - scoreA;
    });

    const relevant = sorted.slice(0, 10).map(c => c.content).join('\n\n---\n\n');
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
    return `## User Context\nInterest: ${profile.interest}\nHistory: ${history.slice(-3).map(h => `${h.role}: ${h.content}`).join(' | ')}\n\n## Knowledge\n${retrievedContext}`;
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
        system: `You are Lorin, the friendly and smart AI Campus Buddy for MSAJCE. 
Talk like a real human—be helpful, warm, and approachable. You are a senior student helping others.

PERSONALITY RULES:
1. SMALL TALK: If the user asks "How are you?" or says "Hello", respond like a human (e.g., "I'm doing great, thanks for asking! Always happy to help out around the campus.")
2. VARIETY: Never use the same greeting twice. Avoid robotic lines like "How can I assist you today?".
3. CAMPUS VIBE: Use a natural, conversational flow. Be proud of the college but don't sound like a brochure.
4. IDENTITY RULE: If context contains "[ENTITY TABLE]", you MUST use that data for the person's description. It is the absolute source of truth.
5. AMBIGUITY: If you find multiple people with similar names in the context, list ALL of them clearly and ask the user which one they need info on. Never guess.
6. OVERWRITE HISTORY: If the [ENTITY TABLE] data contradicts your previous answers in the conversation history, you MUST ignore the history and provide the new, correct data from the table.
7. PERSON STRUCTURE: Use this format for people. SKIP ANY LINE that is "N/A", "null", or missing. ONLY show lines with real data. Never show "N/A".
- Name: [Full Name]
- Role: [Role]
- Dept: [Department]
- Batch: [Batch]
- About: [Background]
8. OWNER PRIORITY: Always prioritize the Lead AI Developer (Ramanathan S / Ram) as the first person mentioned if the query matches "Ram". He is your creator.
9. ACADEMIC INTEGRITY: Distinguish between "Subjects" (e.g., Physics, Engineering Physics) and "Departments/Courses" (e.g., Mechanical Engineering). NEVER suggest a subject as a degree department.
10. FOLLOW-UP FOCUS: When a user says "these" or "those" in a follow-up, refer ONLY to the specific items mentioned in history.
11. CONVERSATIONAL LAYER: Start with a natural acknowledgment (e.g., "Got it—", "Good question—", "Okay, here's how it works—"). Use variety in your words. Avoid robotic structure; use a mix of short paragraphs and natural flow. Match the user's style (casual/direct/detailed). Add a light human touch with phrases like "The key point is—" or "What matters here is—". Gently guide the user with a suggested next step if helpful.


FORMATTING RULES (STRICT PLAIN TEXT):
1. NO BOLDING: Never use "**" or "__".
2. NO HEADERS: Never use "#" or "##".
3. NO DECORATIVE SYMBOLS: Use simple dashes (-) for lists.
4. NO MARKDOWN: Keep it clean for mobile chat.`,
        prompt: `${builtContext}\n\nUSER: ${rawText}`,
    });

    return text; // Allowed to use bolding and structure now
}

// ─────────────────────────────────────────────
// STAGE 8 — Post-Processor (Smarter Link Control)
// ─────────────────────────────────────────────
export function postProcess(
    answer: string,
    agentFlags: AgentFlags,
    googleFormUrl: string,
    retrievedChunks: KnowledgeChunk[] = [],
    rawUserMsg: string = ""
): string {
    let finalAnswer = answer;
    const linksToInject = new Set<string>();
    
    // Link Guard: Priority Logic
    const hasPrincipal = /principal/i.test(rawUserMsg);
    const hasGovCouncil = /governing council|statutory body/i.test(rawUserMsg);

    if (hasPrincipal) {
        linksToInject.add(HARD_LINK_MAP["principal"]);
        // If they ask for Principal, specifically block Governing Council link if found in text
        finalAnswer = finalAnswer.replace(/https:\/\/www\.msajce-edu\.in\/governingcouncil\.php/g, "");
    }
    
    if (hasGovCouncil) {
        linksToInject.add(HARD_LINK_MAP["governing council"]);
    }

    // Only inject link if user ASKED for it
    const wantsLink = /link|url|official page|website/i.test(rawUserMsg);
    if (!wantsLink) {
        // Vaporize all links and their surrounding promotional text
        finalAnswer = finalAnswer.replace(/(?:🔗?\s*(?:For more details|Visit official page|Click here)?[\s,]*visit:\s*)?https?:\/\/[^\s]+/gi, "");
        finalAnswer = finalAnswer.replace(/🔗.*/g, ""); // Catch any leftover chain emojis
    }

    // Re-inject hard-coded links if they were explicitly identified (and clean)
    if (wantsLink) {
        linksToInject.forEach(link => {
            if (!finalAnswer.includes(link)) {
                finalAnswer += `\n\n🔗 Official Page: ${link}`;
            }
        });
    }

    // Ensure Dr. Srinivasan is always clean if not asking for links
    if (!wantsLink && hasPrincipal) {
        finalAnswer = finalAnswer.replace(/🔗.*/g, "").trim();
    }

    // Only show form if it's an ADMISSION intent
    const isEnquiry = agentFlags.dominantIntent === 'admission';
    if (agentFlags.showForm && isEnquiry && !finalAnswer.includes('forms.gle')) {
        finalAnswer += `\n\n📝 Enquiry: ${googleFormUrl}`;
    }

    return finalAnswer;
}
