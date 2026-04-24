import { Bot, webhookCallback } from 'grammy';
import { performLorinRetrieval } from '../lib/retrieve';
import { getMemory, saveMemory } from '../lib/memory';

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) throw new Error('TELEGRAM_BOT_TOKEN is required');

const bot = new Bot(token);

// EMERGENCY WEBHOOK RESET COMMAND
bot.command('setup', async (ctx) => {
    try {
        const domain = process.env.VERCEL_URL || 'your-vercel-domain.vercel.app';
        await bot.api.setWebhook(`https://${domain}/api/bot`);
        await ctx.reply(`✅ Webhook reset to: https://${domain}/api/bot`);
    } catch (e: any) {
        await ctx.reply(`❌ Setup failed: ${e.message}`);
    }
});

bot.command('start', (ctx) => ctx.reply("👋 Lorin is Online! I've implemented an emergency bypass. Ask me anything!"));

bot.on('message:text', async (ctx) => {
    const userId = ctx.from.id;
    const text = ctx.message.text;

    await ctx.replyWithChatAction('typing');

    try {
        // 1. FASTER MEMORY FETCH (With 2s Race)
        const history = await Promise.race([
            getMemory(userId),
            new Promise((resolve) => setTimeout(() => resolve([]), 2000)) // Force continue after 2s
        ]) as any;

        // 2. RETRIEVAL (With 7s Race)
        const result = await Promise.race([
            performLorinRetrieval(text, userId, 'session', history),
            new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), 7000))
        ]) as any;

        await saveMemory(userId, text, result.answer).catch(() => {}); // Passive save
        await ctx.reply(result.answer, { parse_mode: 'Markdown' });

    } catch (err: any) {
        console.error('[CRITICAL]:', err.message);
        // Fallback for any error
        await ctx.reply("✨ I'm recalibrating my campus map! Please try that question again in 10 seconds.");
    }
});

export default async function handler(req: any, res: any) {
    if (req.method === 'POST') {
        try {
            return await webhookCallback(bot, 'https')(req, res);
        } catch (e) {
            console.error('Webhook Error:', e);
            res.status(500).end();
        }
    } else {
        res.status(200).send('Lorin Node is Healthy 🟢');
    }
}
