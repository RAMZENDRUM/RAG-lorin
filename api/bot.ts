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

// Setup bot logic (same as main.ts but for webhook)
bot.start((ctx) => ctx.reply('Welcome to Lorin! I am your 24/7 MSAJCE Virtual Concierge.'));

bot.on('text', async (ctx) => {
    try {
        const userId = ctx.from.id.toString();
        const rawText = ctx.message.text;

        const { shortTerm, profile } = await fetchMemory(userId, sql);
        const intent = classifyIntent(rawText);
        const rewrittenQuery = rewriteQuery(rawText, intent, profile, shortTerm);
        const chunks = await hybridRetrieve(rewrittenQuery, rawText, openai, sql);
        const rerankedContext = await rerankResults(rewrittenQuery, chunks, openai);
        const agentFlags = agentDecide(intent, rawText, rerankedContext, profile.last_seen.getTime(), GOOGLE_FORM_URL);
        const finalContext = buildContext(rerankedContext, shortTerm, profile);
        const answer = await generateGrounded(finalContext, rawText, agentFlags, GOOGLE_FORM_URL, openai);
        const finalOutput = postProcess(answer, agentFlags, GOOGLE_FORM_URL, chunks);

        // Update Memory
        const newInterest = extractInterest(rawText);
        await updateProfile(userId, { 
            interest: newInterest || profile.interest,
            last_seen: new Date()
        }, sql);

        await sql`INSERT INTO chat_history (user_id, role, content) VALUES (${userId}, 'user', ${rawText})`;
        await sql`INSERT INTO chat_history (user_id, role, content) VALUES (${userId}, 'assistant', ${finalOutput})`;

        await ctx.reply(finalOutput, { parse_mode: 'Markdown' });

    } catch (e: any) {
        console.error('Webhook Error:', e.message);
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
