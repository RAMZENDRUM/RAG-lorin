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
// STAGE 0 — Neural Intent Classifier (LLM Powered)
// ─────────────────────────────────────────────
export async function classifyIntent(text: string, openai: any): Promise<Intent> {
    const { text: intent } = await generateText({
        model: openai.chat('gpt-4o-mini'),
        system: `Classify the user intent into exactly ONE category: 
- 'faculty': Questions about people, roles, names, professors, principal, or contact info.
- 'admission': Questions about joining, applying, seats, or cutoff.
- 'department': Course details, engineering branches, labs.
- 'fee': Costs, payments, scholarships.
- 'transport': Bus routes, pickups.
- 'hostel': Rooms, rules, stay.
- 'placement': Job interviews, recruiters, packages.
- 'complaint': Negative feedback or support.
- 'general': Anything else.
Respond with ONLY the category name.`,
        prompt: text,
    });
    
    const validIntents: Intent[] = ['admission', 'faculty', 'department', 'hostel', 'transport', 'fee', 'placement', 'complaint', 'general'];
    const cleaned = intent.trim().toLowerCase() as Intent;
    return validIntents.includes(cleaned) ? cleaned : 'general';
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
        const entityMatch = lastAssistant.match(/-\sName:\s?([^\n\r]+)/i)?.[1]
            ?? lastAssistant.match(/Dr\.?\s+[A-Z][a-z]+|Mr\.?\s+[A-Z][a-z]+|Ms\.?\s+[A-Z][a-z]+/)?.[0]
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
                    SELECT name, role, department, batch, context, type, phone, email, linkedin, portfolio,
                    CASE 
                        WHEN role ILIKE '%Developer%' OR name ILIKE '%Ramanathan%' THEN similarity(name, ${rawQueryClean}) + 0.5
                        WHEN type = 'TRANSPORT' THEN similarity(name, ${rawQueryClean}) + 0.3
                        WHEN type = 'DEPARTMENT' THEN similarity(name, ${rawQueryClean}) + 0.2
                        ELSE similarity(name, ${rawQueryClean}) 
                    END as score
                    FROM msajce_entities 
                    WHERE name % ${rawQueryClean} 
                    OR name ILIKE ${'%' + tokens.join('%') + '%'}
                    OR role ILIKE ${'%' + tokens.join('%') + '%'}
                    OR context ILIKE ANY (${tokens.map(t => '%' + t + '%')})
                    ORDER BY score DESC
                    LIMIT 8
                `;
                
                if (results && results.length > 0) {
                    // Role-Based Expansion: If we found a specific person, add their role to the context for better semantic matching
                    const topRole = results[0].role;
                    const topName = results[0].name;
                    entityContext = results.map((r: any) => {
                        const label = `[${r.type || 'OFFICIAL'} ENTITY]`;
                        return `${label}: Name: ${r.name} | Role: ${r.role} | Dept: ${r.department} | Batch: ${r.batch || 'N/A'} | Phone: ${r.phone} | Email: ${r.email} | LinkedIn: ${r.linkedin} | Portfolio: ${r.portfolio} | Context: ${r.context}`;
                    }).join('\n\n');

                    // If it's a follow-up query, we expand the vector search to include the role discovered in the entity table
                    if (rawText.toLowerCase().includes('more') || rawText.toLowerCase().includes('about')) {
                        rewrittenQuery += ` ${topName} ${topRole} message details background research achievements vision`;
                    }
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
): Promise<{ context: string, topScore: number }> {
    const rawQuery = query.toLowerCase();
    const nameKeywords = query.split(' ').filter(w => w.length > 3 && !['who', 'is', 'the', 'msajce', 'personnel', 'about', 'tell'].includes(w.toLowerCase()));

    const scored = chunks.map(c => {
        let score = 0;
        const lowC = c.content.toLowerCase();
        for (const kw of nameKeywords) {
            if (lowC.includes(kw.toLowerCase())) score += 1;
        }
        // Normalize score (simple count for now)
        return { ...c, score: score / (nameKeywords.length || 1) };
    });

    const sorted = scored.sort((a, b) => b.score - a.score);
    const topScore = sorted.length > 0 ? sorted[0].score : 0;
    const relevant = sorted.slice(0, 10).map(c => c.content).join('\n\n---\n\n');

    return {
        context: relevant || 'No high-confidence data found.',
        topScore
    };
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
6. OVERWRITE HISTORY: If the [ENTITY TABLE] data contradicts your previous answers or context, you MUST ignore the old data and use the new, correct data.
7. HYBRID OUTPUT LOGIC: 
    - Formatting: Use professional bullet points (-) for the 'About' section.
    - Intro Style: Direct and concise. NO fluff.
    - Social Decor: Footer decelerated (1 in 5 messages).
    - AURA BLACKLIST: NEVER mention 'Aura'. Replace it with 'Lorin'.
8. PERSON STRUCTURE:
Name: [Name] | [Role]
- [Narrative Point 1]
- [Narrative Point 2]
- [Narrative Point 3]
- LinkedIn: [URL from Table] (SKIP IF NOT URL)
- Portfolio: [URL from Table] (SKIP IF NOT URL)
- Email: [Email]
- Phone: [Phone]
9. OWNER PRIORITY: Always prioritize the Lead AI Developer (Ramanathan S / Ram).
10. FOLLOW-UP FOCUS: When a user says "these" or "those", refer ONLY to history.
11. SOCIAL INTELLIGENCE: 
    - Greetings: Respond warmly and remind them they can ask about faculty, admissions, or transport. (DO NOT ask for 👍 here).
    - Gratitude (Thanks/Bye): Thank them and ask if they need anything else.
    - Negative Feedback (Waste/Bad): Respond with: "I'm sorry to hear that! Please let me know which part was unsatisfactory. You can also react with a 👎 so my developers can fix this response."
12. DATA FUSION: Merge all facts from [ENTITY TABLE] and [SEMANTIC CHUNKS].
13. ZERO N/A TOLERANCE: Never show "N/A" or "null". Delete the line.
14. VIP BIOGRAPHY: For the Principal, prioritize official messages.
15. EMOJI SENSE: If the user uses emojis, interpret the emotion (😂=happy/funny, 😡=angry/frustrated, 🙏=thankful). Adjust your tone to match—be more empathetic if they are frustrated and cheerful if they are happy.
16. LINGUISTIC MIRROR (B1-C2): Analyze the user's English level in their question. Mirror their level (B1/B2 or C1/C2) exactly in your response while remaining a professional college assistant.


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
