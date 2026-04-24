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
import fs from 'fs-extra';
import path from 'path';

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
fs.ensureDirSync(path.join(process.cwd(), 'logs'));

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

        // --- STAGE 3-4: Hybrid Retrieval (High-Recall for People)
        const isIdentity = intent === 'identity' || /who is|tell me about|contact|professor|dr\.|mr\./i.test(rawText);
        const chunks = await hybridRetrieve(rewrittenQuery, rawText, openai, sql, isIdentity ? 35 : 15);

        // --- STAGE 4.5: LLM Reranking (Cost Optimized) ---
        const context = await rerankResults(rewrittenQuery, chunks, openai);

        // Stage 5-6: Framing
        const lastSeenTime = profile.last_seen instanceof Date 
            ? profile.last_seen.getTime() 
            : Date.now();

        const agentFlags = agentDecide(intent, rawText, context, lastSeenTime, GOOGLE_FORM_URL);
        const finalContext = buildContext(context, shortTerm, profile);
        
        // Stage 7-8: Generating & Processing (Personality Layer Active)
        const answer = await generateGrounded(finalContext, rawText, agentFlags, GOOGLE_FORM_URL, openai);
        const finalOutput = postProcess(answer, agentFlags, GOOGLE_FORM_URL, chunks, rawText);

        // --- STAGE 9: Memory Update & Audit Logging ---
        const newInterest = extractInterest(rawText);
        const finalEngagement = (shortTerm.length / 2) + 1; // Approx turns
        const isFailure = context.includes('No data found');
        const isNegative = agentFlags.dominantIntent === 'complaint' || /bad|worst|scam|waste/i.test(rawText);

        const auditTrail = {
            timestamp: new Date().toISOString(),
            userId,
            intent: agentFlags.dominantIntent,
            engagementScore: finalEngagement,
            isFailure,
            isNegative,
            query: rawText,
            outcome: finalEngagement > 3 ? 'High Intent' : 'Exploring'
        };

        // Write to persistent audit log for the Sunday Report
        await sql`INSERT INTO lorin_audit_logs (data) VALUES (${auditTrail})`;
        await fs.appendFile(path.join(process.cwd(), 'logs', 'audit.jsonl'), JSON.stringify(auditTrail) + '\n');

        await updateProfile(userId, { 
            interest: newInterest || profile.interest || undefined,
        }, sql);

        // Persistent history save
        await sql`INSERT INTO chat_history (user_id, role, content) VALUES (${userId}, 'user', ${rawText})`;
        await sql`INSERT INTO chat_history (user_id, role, content) VALUES (${userId}, 'assistant', ${finalOutput})`;

        await ctx.reply(finalOutput, { parse_mode: 'Markdown' });

    } catch (error: any) {
        console.error('CRITICAL ORCHESTRATION ERROR:', error);
        await ctx.reply("I'm refocusing my circuits! Please ask that again? 🤖🔄");
    }
});

bot.launch().then(() => console.log('✅ LORIN IS ONLINE (FULL ORCHESTRATION)'));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
