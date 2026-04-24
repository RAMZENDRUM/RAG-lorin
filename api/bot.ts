import { Telegraf } from 'telegraf';
import { performLorinRetrieval } from '../lib/retrieve.js';
import dotenv from 'dotenv';
import type { VercelRequest, VercelResponse } from '@vercel/node';

dotenv.config();

let bot: Telegraf;
try {
    const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    if (BOT_TOKEN) {
        bot = new Telegraf(BOT_TOKEN);
    } else {
        console.error('TELEGRAM_BOT_TOKEN is missing');
    }
} catch (err) {
    console.error('Bot Initialization Error:', err);
}

import { getChatHistory, saveChatMessage, type ChatMessage } from '../lib/memory.js';

// Rate limiting (In-memory is fine for rate limits as they are per-request/short-term)
const userLimits = new Map<number, { countMin: number; countDay: number; resetMin: number; resetDay: number }>();
const userLastMsg = new Map<number, { text: string; count: number }>();
const userSuspensions = new Map<number, number>();
const bannedUsers = new Set<number>();

bot.start((ctx) => ctx.reply("Hello! I'm Lorin, the MSAJCE AI Concierge. Ask me anything about transport, admissions, or departments! 🎓🚀"));

bot.on('text', async (ctx) => {
    try {
        const from = ctx.from;
        if (!from) return;

        const username = from.username?.toLowerCase() || '';
        const userId = from.id;
        const msgText = ctx.message.text;

        // Security Checks
        if (bannedUsers.has(userId)) return;
        const suspension = userSuspensions.get(userId);
        if (suspension && Date.now() < suspension) return;

        // Repetition Protection
        let lastMsg = userLastMsg.get(userId) || { text: '', count: 0 };
        if (lastMsg.text === msgText) { 
            lastMsg.count++; 
        } else { 
            lastMsg = { text: msgText, count: 1 }; 
        }
        userLastMsg.set(userId, lastMsg);

        if (lastMsg.count >= 5) {
            userSuspensions.set(userId, Date.now() + 3600000);
            return ctx.reply("I'm not a parrot. Since you love repeating yourself, I'm taking an hour-long break from you. Bye! 🦜🚫");
        }

        // Rate Limiting (Skip for admin)
        if (username !== 'zendrum' && username !== 'zendrum_') {
            const now = Date.now();
            let limits = userLimits.get(userId) || { countMin: 0, countDay: 0, resetMin: now + 60000, resetDay: now + 86400000 };
            
            if (now > limits.resetMin) { limits.countMin = 0; limits.resetMin = now + 60000; }
            if (now > limits.resetDay) { limits.countDay = 0; limits.resetDay = now + 86400000; }
            
            if (limits.countMin >= 5) {
                bannedUsers.add(userId);
                return ctx.reply("You've officially spammed your way into my blocklist. Goodbye! 👋🗑️");
            }
            if (limits.countDay >= 35) return ctx.reply("You've asked 35 questions today. Take a break! See you tomorrow 😴");
            
            limits.countMin++;
            limits.countDay++;
            userLimits.set(userId, limits);
        }

        // --- PERSISTENT MEMORY LOGIC ---
        // 1. Fetch History from Supabase
        const history: ChatMessage[] = await getChatHistory(userId, 6); // Last 6 messages (3 turns)
        
        const sessionId = `tg_${userId}_${Math.floor(Date.now() / 3600000)}`;
        await ctx.sendChatAction('typing');

        // 2. Perform Retrieval
        const result = await performLorinRetrieval(msgText, userId, sessionId, history);
        
        // 3. Save Context to Supabase (User message + Assistant response)
        await saveChatMessage(userId, 'user', msgText, sessionId);
        await saveChatMessage(userId, 'assistant', result.answer, sessionId);

        await ctx.reply(result.answer, { parse_mode: 'Markdown' });
    } catch (e: any) {
        console.error('Text Handler Error:', e);
        // Silently fail or send a graceful error
    }
});

// Vercel Serverless Handler
export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method === 'POST') {
        try {
            await bot.handleUpdate(req.body);
            res.status(200).json({ ok: true });
        } catch (err: any) {
            console.error('Bot Error:', err);
            res.status(500).json({ 
                error: 'Internal Error', 
                message: err.message,
                stack: err.stack
            });
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
