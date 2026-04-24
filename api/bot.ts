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
const DATABASE_URL = process.env.DATABASE_URL!;
const GOOGLE_FORM_URL = "https://forms.gle/your-admission-form";

// Initialization
const bot = new Telegraf(BOT_TOKEN!);
const sql = postgres(DATABASE_URL, { ssl: 'require' });
const openai = createOpenAI({
    apiKey: process.env.VERCEL_AI_KEY || process.env.OPENAI_API_KEY,
    baseURL: 'https://ai-gateway.vercel.sh/v1'
});

bot.start((ctx) => ctx.reply('Welcome to Lorin! I am your smart MSAJCE Concierge. How can I help you today?'));

bot.on('text', async (ctx) => {
    try {
        const userId = ctx.from.id.toString();
        const rawText = ctx.message.text;

        // Stage 0: Context
        const { shortTerm, profile } = await fetchMemory(userId, sql);
        
        // Stage 1-2: Classification & Expansion
        const intent = classifyIntent(rawText);
        const rewrittenQuery = rewriteQuery(rawText, intent, profile, shortTerm);
        
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

        // Memory & Audit
        const newInterest = extractInterest(rawText);
        await updateProfile(userId, { 
            interest: newInterest || profile.interest || undefined,
        }, sql);

        await sql`INSERT INTO chat_history (user_id, role, content) VALUES (${userId}, 'user', ${rawText})`;
        await sql`INSERT INTO chat_history (user_id, role, content) VALUES (${userId}, 'assistant', ${finalOutput})`;

        await ctx.reply(finalOutput, { parse_mode: 'Markdown' });

    } catch (e: any) {
        console.error('Webhook Orchestration Error:', e);
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
