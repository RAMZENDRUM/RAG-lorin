import { Bot, webhookCallback } from 'grammy';
import { performLorinRetrieval } from '../lib/retrieve';
import { getMemory, saveMemory } from '../lib/memory';

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) throw new Error('TELEGRAM_BOT_TOKEN is required');

const bot = new Bot(token);

bot.command('start', (ctx) => ctx.reply("👋 Hello! I am Lorin, your smart MSAJCE Campus Concierge. I've been hardened with new stability shields. Ask me anything!"));

bot.on('message:text', async (ctx) => {
    const userId = ctx.from.id;
    const text = ctx.message.text;

    await ctx.replyWithChatAction('typing');

    // Timeout guard for Vercel (10s limit)
    const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('REQUEST_TIMEOUT')), 8500)
    );

    try {
        console.log(`[Bot] Request from ${userId}: ${text}`);
        
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
        const errorMsg = err.message === 'REQUEST_TIMEOUT' 
            ? "⏱️ Information retrieval is taking a bit longer than usual. Please try asking again in a moment!" 
            : "🛠️ I'm briefly recalibrating my brain. I'll be ready for your next question in a few seconds!";
        
        await ctx.reply(errorMsg);
    }
});

// VERCEL SPECIFIC HANDLER (RE-ESTABLISHING THE LINK)
export default async function handler(req: any, res: any) {
    if (req.method === 'POST') {
        return webhookCallback(bot, 'https')(req, res);
    }
    res.status(200).send('Lorin Bot is Online 🚀');
}
