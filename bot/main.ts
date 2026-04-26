import { Telegraf } from 'telegraf';
// @ts-ignore
import * as dotenv from 'dotenv';
// @ts-ignore
import { default as postgres } from 'postgres';
import { 
    classifyIntent, 
    fetchMemory, 
    orchestrate 
} from '../lib/core/orchestrator.js';

dotenv.config();

/**
 * LOCAL DEVELOPMENT BOT ENGINE
 */
const sql = postgres(process.env.DATABASE_URL!, { ssl: 'require' });
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!);

console.log('🚀 Lorin Local Development Mode: Active');

bot.on('text', async (ctx) => {
    const userId = ctx.from.id.toString();
    const rawText = ctx.message.text;

    try {
        // Stage 0: Load Narrative History
        const { shortTerm, profile } = await fetchMemory(userId, sql);

        // Stage 1-5: Unified Orchestration
        const { answer } = await orchestrate(
            userId,
            rawText,
            shortTerm,
            profile,
            sql
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
