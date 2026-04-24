/**
 * Lorin v2 — Master Bot Handler
 * Wires the 9-stage orchestrator to Grammy + Vercel
 */

import { Bot, webhookCallback } from 'grammy';
import { createOpenAI } from '@ai-sdk/openai';
import postgres from 'postgres';

import {
    classifyIntent,
    rewriteQuery,
    hybridRetrieve,
    rerankResults,
    agentDecide,
    buildContext,
    generateGrounded,
    postProcess,
} from '../lib/orchestrator.js';

import {
    fetchMemory,
    updateProfile,
    extractInterest,
} from '../lib/memory.js';

// ── Constants ────────────────────────────────────────────────────────────────
const GOOGLE_FORM_URL = 'https://forms.gle/Fto1EWFofwQdnjoz7';
const COLLECTION = 'lorin_msajce_knowledge';

// ── Lazy Singletons ──────────────────────────────────────────────────────────
const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) throw new Error('TELEGRAM_BOT_TOKEN is required');
const bot = new Bot(token);

let _sql: ReturnType<typeof postgres> | null = null;
function getSql() {
    if (!_sql && process.env.DATABASE_URL) {
        _sql = postgres(process.env.DATABASE_URL, { ssl: 'require', connect_timeout: 10 });
    }
    return _sql;
}

function getOpenAI() {
    const key = process.env.VERCEL_AI_KEY || process.env.OPENAI_API_KEY;
    return createOpenAI({
        apiKey: key,
        baseURL: key?.startsWith('vck_') ? 'https://ai-gateway.vercel.sh/v1' : undefined,
    });
}

// ── Commands ─────────────────────────────────────────────────────────────────
bot.command('start', (ctx) =>
    ctx.reply(
        `👋 Hey! I'm *Lorin*, your Mohamed Sathak A.J. College (Chennai) campus buddy! 🎓✨\n\nI can help you with:\n🏢 *Departments* — CSE, AI&DS, ECE, CSBS & more\n📝 *Admissions* — Process, eligibility, form\n🏠 *Hostels* — Facilities & fees\n🚌 *Transport* — Bus routes\n👩‍🏫 *Faculty* — HODs, Principal, Admin\n💼 *Placements* — Companies & packages\n\nWhat's on your mind? 😊`,
        { parse_mode: 'Markdown' }
    )
);

bot.command('form', (ctx) =>
    ctx.reply(`📝 *Admission Enquiry Form*\n${GOOGLE_FORM_URL}`, { parse_mode: 'Markdown' })
);

// ── Main Message Handler (The 9-Stage Pipeline) ───────────────────────────────
bot.on('message:text', async (ctx) => {
    const userId = ctx.from.id.toString();
    const rawText = ctx.message.text.trim();
    await ctx.replyWithChatAction('typing');

    try {
        const openai = getOpenAI();
        const db = getSql();

        // ── STAGE 1: Intent Classification ──────────────────────────────────
        const intent = classifyIntent(rawText);

        // ── STAGE 3: Memory Fetch (parallel with stage 2) ───────────────────
        const { shortTerm, profile } = db
            ? await fetchMemory(userId, db)
            : { shortTerm: [], profile: { user_id: userId, name: null, interest: null, stage: 'unknown' as const, last_seen: new Date() } };

        // ── STAGE 2: Query Rewriter ──────────────────────────────────────────
        const rewrittenQuery = rewriteQuery(rawText, intent, profile);

        // ── STAGE 4: Hybrid Retrieval ───────────────────────────────────
        const rawChunks = await hybridRetrieve(rewrittenQuery, rawText, openai, db);

        // ── STAGE 4.5: Cohere Reranker ───────────────────────────────
        const retrievedContext = await rerankResults(rewrittenQuery, rawChunks);

        // ── Check last form send time from short-term memory ────────────────
        const lastFormMsg = [...shortTerm].reverse().find(
            h => h.role === 'assistant' && h.content.includes('forms.gle')
        );
        const lastFormTime = lastFormMsg?.created_at ? new Date(lastFormMsg.created_at).getTime() : 0;

        // ── STAGE 5: Agent Decision ──────────────────────────────────────────
        const agentFlags = agentDecide(intent, rawText, retrievedContext, lastFormTime, GOOGLE_FORM_URL);

        // ── STAGE 6: Context Builder ─────────────────────────────────────────
        const builtContext = buildContext(retrievedContext, shortTerm, profile);

        // ── STAGE 7: Grounded LLM Generation ────────────────────────────────
        const rawAnswer = await generateGrounded(builtContext, rawText, agentFlags, GOOGLE_FORM_URL, openai);

        // ── STAGE 8: Post-Processing ─────────────────────────────────────────
        const finalReply = postProcess(rawAnswer, agentFlags, GOOGLE_FORM_URL);

        // ── STAGE 9: Storage + Delivery ──────────────────────────────────────
        if (db) {
            const interest = extractInterest(rawText);
            const stage = intent === 'admission' ? 'exploring' : undefined;

            await Promise.all([
                db`INSERT INTO chat_history (user_id, role, content) VALUES
                    (${userId}, 'user', ${rawText}),
                    (${userId}, 'assistant', ${finalReply})`,
                interest || stage
                    ? updateProfile(userId, { interest: interest ?? undefined, stage }, db)
                    : Promise.resolve(),
            ]);
        }

        await ctx.reply(finalReply, { parse_mode: 'Markdown' });

    } catch (err: any) {
        console.error(`[Lorin v2 Error] Stage failed: ${err.message}`);
        await ctx.reply("✨ I hit a small snag — ask me again and I'll get it right!");
    }
});

// ── Vercel Serverless Handler ─────────────────────────────────────────────────
export default async function handler(req: any, res: any) {
    if (req.method === 'POST') {
        return webhookCallback(bot, 'https')(req, res);
    }
    res.status(200).send('Lorin v2: ONLINE 🟢 (Orchestrated Intelligence Active)');
}
