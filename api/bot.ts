import { Bot, webhookCallback } from 'grammy';
import { performLorinRetrieval } from '../lib/retrieve';
import { getMemory, saveMemory } from '../lib/memory';

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) throw new Error('TELEGRAM_BOT_TOKEN is required');

const bot = new Bot(token);

bot.command('start', (ctx) => ctx.reply("👋 Lorin is Online! I've optimized my brain for speed. Ask me anything!"));

bot.on('message:text', async (ctx) => {
    const userId = ctx.from.id;
    const text = ctx.message.text;

    await ctx.replyWithChatAction('typing');

    try {
        // Simple sequential flow for max stability on Vercel
        const history = await getMemory(userId);
        const result = await performLorinRetrieval(text, userId, 'session', history);
        
        await saveMemory(userId, text, result.answer);
        await ctx.reply(result.answer, { parse_mode: 'Markdown' });

    } catch (err: any) {
        console.error('[BOT ERROR]:', err.message);
        await ctx.reply("📡 I hit a small connection snag. Could you ask that again?");
    }
});

export default async function handler(req: any, res: any) {
    if (req.method === 'POST') {
        return webhookCallback(bot, 'https')(req, res);
    }
    res.status(200).send('Lorin Node: ACTIVE 🟢');
}
