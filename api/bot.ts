import { Bot, webhookCallback } from 'grammy';
import { performLorinRetrieval } from '../lib/retrieve';
import { getMemory, saveMemory } from '../lib/memory';

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) throw new Error('TELEGRAM_BOT_TOKEN is required');

const bot = new Bot(token);

bot.command('start', (ctx) => ctx.reply("👋 Lorin is back online with her full HQ brain! Ask me anything about MSAJCE. 🎓"));

bot.on('message:text', async (ctx) => {
    const userId = ctx.from.id;
    const text = ctx.message.text;

    await ctx.replyWithChatAction('typing');

    try {
        // 1. FAST MEMORY FETCH
        const history = await Promise.race([
            getMemory(userId),
            new Promise((resolve) => setTimeout(() => resolve([]), 2500))
        ]) as any;

        // 2. ELITE RAG RETRIEVAL
        const result = await Promise.race([
            performLorinRetrieval(text, userId, 'session', history),
            new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), 8000))
        ]) as any;

        await saveMemory(userId, text, result.answer).catch(() => {}); 
        await ctx.reply(result.answer, { parse_mode: 'Markdown' });

    } catch (err: any) {
        console.error('[BOT ERROR]:', err.message);
        if (err.message === 'TIMEOUT') {
            await ctx.reply("⏱️ I'm researching that for you, but it's taking a moment. Please ask one more time!");
        } else {
            await ctx.reply("📡 Connecton stable, but my knowledge base is refreshing. Try that again in 5 seconds!");
        }
    }
});

export default async function handler(req: any, res: any) {
    if (req.method === 'POST') {
        return webhookCallback(bot, 'https')(req, res);
    }
    res.status(200).send('Lorin Engine: ONLINE 🟢');
}
