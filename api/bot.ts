import { Telegraf } from 'telegraf';
import { performLorinRetrieval } from '../lib/retrieve';
import dotenv from 'dotenv';
import type { VercelRequest, VercelResponse } from '@vercel/node';

dotenv.config();

let bot: Telegraf;
try {
    const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!;
    bot = new Telegraf(BOT_TOKEN);
} catch (err) {
    console.error('Bot Initialization Error:', err);
}

const userLimits = new Map<number, { countMin: number; countDay: number; resetMin: number; resetDay: number }>();
const userSessions = new Map<number, { role: 'user' | 'assistant'; content: string }[]>();
const userLastMsg = new Map<number, { text: string; count: number }>();
const userSuspensions = new Map<number, number>();
const bannedUsers = new Set<number>();

bot.start((ctx) => ctx.reply("Hello! I'm Lorin, the MSAJCE AI Concierge. Ask me anything about transport, admissions, or departments! 🎓🚀"));

bot.on('text', async (ctx) => {
    try {
        const username = ctx.from?.username?.toLowerCase() || '';
        const userId = ctx.from?.id;
        const msgText = ctx.message.text;

        if (bannedUsers.has(userId)) return;
        const suspension = userSuspensions.get(userId);
        if (suspension && Date.now() < suspension) return;

        let lastMsg = userLastMsg.get(userId) || { text: '', count: 0 };
        if (lastMsg.text === msgText) { lastMsg.count++; } else { lastMsg = { text: msgText, count: 1 }; }
        userLastMsg.set(userId, lastMsg);
        if (lastMsg.count >= 5) {
            userSuspensions.set(userId, Date.now() + 3600000);
            return ctx.reply("I'm not a parrot. Since you love repeating yourself, I'm taking an hour-long break from you. Bye! 🦜🚫");
        }

        if (username !== 'zendrum' && username !== 'zendrum_') {
            const now = Date.now();
            let limits = userLimits.get(userId) || { countMin: 0, countDay: 0, resetMin: now + 60000, resetDay: now + 86400000 };
            if (now > limits.resetMin) { limits.countMin = 0; limits.resetMin = now + 60000; }
            if (now > limits.resetDay) { limits.countDay = 0; limits.resetDay = now + 86400000; }
            if (limits.countMin >= 5) {
                bannedUsers.add(userId);
                return ctx.reply("You've officially spammed your way into my blocklist. Goodbye! 👋🗑️");
            }
            if (limits.countDay >= 25) return ctx.reply("You've asked 25 questions today. Take a break! See you tomorrow 😴");
            limits.countMin++;
            limits.countDay++;
            userLimits.set(userId, limits);
        }

        let history = userSessions.get(userId) || [];
        const sessionId = `tg_${userId}_${Math.floor(Date.now() / 3600000)}`;
        await ctx.sendChatAction('typing');

        const result = await performLorinRetrieval(msgText, userId, sessionId, history);
        history.push({ role: 'user', content: msgText });
        history.push({ role: 'assistant', content: result.answer });
        if (history.length > 8) history = history.slice(-8);
        userSessions.set(userId, history);

        await ctx.reply(result.answer, { parse_mode: 'Markdown' });
    } catch (e) {
        console.error(e);
    }
});

// Vercel Serverless Handler
export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method === 'POST') {
        try {
            await bot.handleUpdate(req.body);
            res.status(200).json({ ok: true });
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: 'Internal Error' });
        }
    } else {
        const envCheck = {
            botToken: !!process.env.TELEGRAM_BOT_TOKEN,
            qdrant: !!process.env.QDRANT_URL,
            cohere: !!process.env.COHERE_API_KEY,
            openai: !!process.env.VERCEL_AI_KEY
        };
        res.status(200).json({ 
            status: 'Lorin RAG Webhook is alive! 🤖', 
            diagnostics: envCheck,
            message: 'If diagnostics are false, please add the missing keys in Vercel Dashboard.'
        });
    }
}
