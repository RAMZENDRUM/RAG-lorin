import { Telegraf } from 'telegraf';
import { 
    classifyIntent, 
    rewriteQuery, 
    hybridRetrieve, 
    rerankResults, 
    agentDecide, 
    buildContext, 
    generateGrounded, 
    postProcess 
} from '../lib/core/orchestrator.js';
import { fetchMemory, updateProfile, extractInterest } from '../lib/core/memory.js';
import { createOpenAI } from '@ai-sdk/openai';
import postgres from 'postgres';
import dotenv from 'dotenv';

dotenv.config();

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const DB_URL = process.env.DATABASE_URL;
const GOOGLE_FORM_URL = "https://forms.gle/your-admission-form";

// Initialization - Safe Database Handle
let sql: any = null;
if (DB_URL) {
    try {
        sql = postgres(DB_URL, { ssl: 'require' });
        console.log("✅ Database linked successfully.");
    } catch (e) {
        console.error("⚠️ Database binding failed:", e);
    }
} else {
    console.warn("🔔 Running in disconnected mode (No DATABASE_URL).");
}

const bot = new Telegraf(BOT_TOKEN!);

// Multi-Key Vercel Helper
function getDynamicAIClient() {
    const VERCEL_KEYS = [
        process.env.VERCEL_AI_KEY,
        process.env.VERCEL_AI_KEY_2,
        process.env.VERCEL_AI_KEY_3,
        process.env.VERCEL_AI_KEY_4
    ].filter(Boolean) as string[];
    
    const activeVercelKey = VERCEL_KEYS[Math.floor(Math.random() * VERCEL_KEYS.length)] || process.env.OPENAI_API_KEY;
    return createOpenAI({
        apiKey: activeVercelKey,
        baseURL: 'https://ai-gateway.vercel.sh/v1'
    });
}

bot.start((ctx) => ctx.reply('Welcome to Lorin! I am your smart MSAJCE Concierge. How can I help you today?'));

bot.on('text', async (ctx) => {
    try {
        const userId = ctx.from.id.toString();
        const rawText = ctx.message.text;
        
        // Dynamically instantiate the AI client per message to guarantee rotation
        const openai = getDynamicAIClient();

        // Stage 0: Context (With failure protection)
        let shortTerm = [];
        let profile = { user_id: userId, name: null, interest: null, stage: 'unknown', last_seen: new Date(), strikes: 0, blocked_until: null };
        
        try {
            const memory = await fetchMemory(userId, sql);
            shortTerm = memory.shortTerm;
            profile = memory.profile;
        } catch (memErr) {
            console.warn('⚠️ Memory Fetch Failed (Falling back to local):', memErr);
        }
        
        // Stage 1-2: Classification & Expansion
        const intent = classifyIntent(rawText);
        const rewrittenQuery = rewriteQuery(rawText, intent, profile as any, shortTerm);
        
        // Stage 3-4: Hybrid Search (High-Recall for People)
        const isIdentity = intent === 'faculty' || /who|tell me about|contact|professor|dr\.|mr\./i.test(rawText);
        const chunks = await hybridRetrieve(rewrittenQuery, rawText, openai, sql, isIdentity ? 35 : 15);
        
        // Stage 4.5: Reranking
        const context = await rerankResults(rewrittenQuery, chunks, openai);
        
        // Stage 5-6: Framing
        const lastSeenTime = profile.last_seen instanceof Date 
            ? profile.last_seen.getTime() 
            : Date.now();

        const agentFlags = agentDecide(intent, rawText, context, lastSeenTime, GOOGLE_FORM_URL);
        const finalContext = buildContext(context, shortTerm, profile);
        
        // Stage 7-8: Generating & Processing (Personality Layer)
        const answer = await generateGrounded(finalContext, rawText, agentFlags, GOOGLE_FORM_URL, openai);
        const finalOutput = postProcess(answer, agentFlags, GOOGLE_FORM_URL, chunks, rawText);

        // Memory & Audit (Non-Blocking)
        try {
            const newInterest = extractInterest(rawText);
            await updateProfile(userId, { 
                interest: newInterest || profile.interest || undefined,
            }, sql);

            await sql`INSERT INTO chat_history (user_id, role, content) VALUES (${userId}, 'user', ${rawText})`;
            await sql`INSERT INTO chat_history (user_id, role, content) VALUES (${userId}, 'assistant', ${finalOutput})`;
        } catch (dbErr: any) {
            console.warn('⚠️ Database Operation Failed:', dbErr.message);
            // We continue anyway so the user gets an answer
        }

        await ctx.reply(finalOutput, { parse_mode: 'Markdown' });

    } catch (e: any) {
        console.error('Webhook Orchestration Error:', e);
        try {
            const maskedUrl = DB_URL ? `${DB_URL.split('@')[1]?.split('/')[0] || 'HIDDEN'}` : 'UNDEFINED';
            await ctx.reply(`⚠️ **System Diagnostics Error:**\n\`${e.message || String(e)}\`\n\n**DB Target:** \`${maskedUrl}\``, { parse_mode: 'Markdown' });
        } catch (fallbackErr) {
            console.error('Diagnostic delivery failed', fallbackErr);
        }
    }
});

// Vercel Serverless Handler
export default async function handler(req: any, res: any) {
    if (req.method === 'POST') {
        try {
            await bot.handleUpdate(req.body);
            res.status(200).send('OK');
        } catch (err) {
            console.error(err);
            res.status(500).send('Error');
        }
    } else {
        res.status(200).send('Lorin Webhook is Active 🤖');
    }
}
