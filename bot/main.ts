import { Telegraf } from 'telegraf';
import dotenv from 'dotenv';
import postgres from 'postgres';
import { getDynamicAIClient } from '../lib/ai/config';
import { 
    classifyIntent, 
    fetchMemory, 
    orchestrate 
} from '../lib/core/orchestrator';

dotenv.config();

/**
 * LOCAL DEVELOPMENT BOT ENGINE
 */
const sql = postgres(process.env.DATABASE_URL!, { ssl: 'require' });
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!);
const openai = getDynamicAIClient();

console.log('🚀 Lorin Local Development Mode: Active');

bot.on('text', async (ctx) => {
    const userId = ctx.from.id.toString();
    const rawText = ctx.message.text;
    const updateId = ctx.update.update_id.toString();

    try {
        // Stage -1: Identity Injection (Alpha Profile)
        const devKeywords = /ram|ramanathan|developer|creator|architect/i;
        let injectedContext = "";
        if (devKeywords.test(rawText)) {
            injectedContext = `[ALPHA PROFILE]: Name: Ramanathan S | Creation: Lorin RAG System | LinkedIn: https://www.linkedin.com/in/ramanathan-s-76a0a02b1 | Portfolio: https://ram-ai-portfolio.vercel.app | Email: ramanathanb86@gmail.com\n\n`;
        }

        // Stage 0: Load Narrative History
        const { shortTerm, profile } = await fetchMemory(userId, sql);

        // Stage 1: Intelligence Cycle
        const intent = await classifyIntent(rawText, openai);

        // Stage 2-5: Unified Orchestration
        const { answer } = await orchestrate(
            rawText,
            intent,
            shortTerm,
            profile,
            openai,
            sql,
            updateId,
            injectedContext
        );

        // Stage 6: Persistent Logging
        try {
            await sql`INSERT INTO chat_history (user_id, role, content) VALUES (${userId}, 'user', ${rawText})`;
            await sql`INSERT INTO chat_history (user_id, role, content) VALUES (${userId}, 'assistant', ${answer})`;
        } catch (dbErr) {
            console.warn('⚠️ Local Sync Warning:', dbErr);
        }

        // Final Dispatch
        await ctx.reply(answer, { parse_mode: 'Markdown' });

    } catch (err: any) {
        console.error('❌ Local Engine Error:', err.message);
        await ctx.reply("System glitch! I'm refocusing my neural links... try again?");
    }
});

bot.launch().then(() => console.log('✅ Bot is polling for updates...'));
