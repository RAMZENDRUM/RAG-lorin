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

if (!BOT_TOKEN) {
    console.error('TELEGRAM_BOT_TOKEN is missing');
    process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);
const sql = postgres(DATABASE_URL, { ssl: 'require' });

// Central OpenAI Client (using Vercel Gateway as standard)
const openai = createOpenAI({
    apiKey: process.env.VERCEL_AI_KEY || process.env.OPENAI_API_KEY,
    baseURL: 'https://ai-gateway.vercel.sh/v1'
});

console.log('🤖 INITIALIZING LORIN (9-STAGE ORCHESTRATOR ACTIVE)...');

bot.start((ctx) => ctx.reply('Welcome to Lorin! I am your smart MSAJCE Concierge. How can I help you today?'));

bot.on('text', async (ctx) => {
    try {
        const userId = ctx.from.id.toString();
        const rawText = ctx.message.text;

        // --- STAGE 0: Identity & Memory Fetch ---
        await ctx.sendChatAction('typing');
        const { shortTerm, profile } = await fetchMemory(userId, sql);

        // --- STAGE 1: Classification ---
        const intent = classifyIntent(rawText);

        // --- STAGE 2: Query Expansion (Matryoshka-Aware) ---
        const rewrittenQuery = rewriteQuery(rawText, intent, profile, shortTerm);

        // --- STAGE 3-4: Hybrid Retrieval ---
        const chunks = await hybridRetrieve(rewrittenQuery, rawText, openai, sql);

        // --- STAGE 4.5: LLM Reranking (Cost Optimized) ---
        const rerankedContext = await rerankResults(rewrittenQuery, chunks, openai);

        // --- STAGE 5: Agent Decisioning ---
        const agentFlags = agentDecide(intent, rawText, rerankedContext, profile.last_seen.getTime(), GOOGLE_FORM_URL);

        // --- STAGE 6: Context Building ---
        const finalContext = buildContext(rerankedContext, shortTerm, profile);

        // --- STAGE 7: Grounded Generation ---
        const answer = await generateGrounded(finalContext, rawText, agentFlags, GOOGLE_FORM_URL, openai);

        // --- STAGE 8: Post-Processing ---
        const finalOutput = postProcess(answer, agentFlags, GOOGLE_FORM_URL);

        // --- STAGE 9: Memory Update ---
        const newInterest = extractInterest(rawText);
        await updateProfile(userId, { 
            interest: newInterest || profile.interest,
            last_seen: new Date()
        }, sql);

        // Persistent history save
        await sql`INSERT INTO chat_history (user_id, role, content) VALUES (${userId}, 'user', ${rawText})`;
        await sql`INSERT INTO chat_history (user_id, role, content) VALUES (${userId}, 'assistant', ${finalOutput})`;

        await ctx.reply(finalOutput, { parse_mode: 'Markdown' });

    } catch (error: any) {
        console.error('Orchestration Error:', error.message);
        await ctx.reply("I'm refocusing my circuits! Please ask that again? 🤖🔄");
    }
});

bot.launch().then(() => console.log('✅ LORIN IS ONLINE (FULL ORCHESTRATION)'));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
