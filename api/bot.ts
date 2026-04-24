import { Bot, webhookCallback } from 'grammy';
import { performLorinRetrieval } from '../lib/retrieve';
import { getMemory, saveMemory } from '../lib/memory';

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) throw new Error('TELEGRAM_BOT_TOKEN is required');

const bot = new Bot(token);

// --- GLOBAL RESILIENCE HANDLER ---
bot.command('start', (ctx) => ctx.reply("👋 Hello! I am Lorin, your smart MSAJCE Campus Concierge. I've been hardened with new stability shields. Ask me anything!"));

bot.on('message:text', async (ctx) => {
    const userId = ctx.from.id;
    const text = ctx.message.text;

    // 1. SILENT FAILURE SHIELD: Always send a 'Thinking' state for UX
    await ctx.replyWithChatAction('typing');

    // 2. TIMEOUT PROTECTION: We must finish in < 10s for Vercel
    const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('REQUEST_TIMEOUT')), 9000)
    );

    try {
        console.log(`[Bot] Request from ${userId}: ${text}`);
        
        // Race the retrieval against the timeout
        const result = await Promise.race([
            (async () => {
                const history = await getMemory(userId);
                const res = await performLorinRetrieval(text, userId, 'session', history);
                await saveMemory(userId, text, res.answer);
                return res;
            })(),
            timeoutPromise
        ]) as any;

        await ctx.reply(result.answer, { parse_mode: 'Markdown' });

    } catch (err: any) {
        console.error('[CRITICAL BOT ERROR]:', err.message);
        
        // 3. FUTURE-PROOF FEEDBACK: Never stay silent
        const errorMsg = err.message === 'REQUEST_TIMEOUT' 
            ? "⏱️ I'm taking a bit longer than usual to think. Could you try asking that again?" 
            : "🛠️ My internal system is undergoing a quick tune-up. I'll be right back with you!";
        
        await ctx.reply(errorMsg);
    }
});

export default webhookCallback(bot, 'https');
