import { Telegraf } from 'telegraf';
import { VercelRequest, VercelResponse } from '@vercel/node';
import { performLorinRetrieval } from '../lib/retrieve.js';
import { getChatHistory, saveChatMessage, type ChatMessage } from '../lib/memory.js';

let bot: Telegraf;

try {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) throw new Error('TELEGRAM_BOT_TOKEN is missing');
    bot = new Telegraf(token);
} catch (err) {
    console.error('Bot Initialization Error:', err);
}

// Global maps for rate limiting (lasts while lambda is warm)
const userLimits = new Map<number, { countMin: number; countDay: number; resetMin: number; resetDay: number }>();
const userLastMsg = new Map<number, { text: string; count: number }>();
const userSuspensions = new Map<number, number>();
const bannedUsers = new Set<number>();

if (bot) {
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

            // 1. Fetch History from Supabase
            const history: ChatMessage[] = await getChatHistory(userId, 6);
            
            const sessionId = `tg_${userId}_${Math.floor(Date.now() / 3600000)}`;
            await ctx.sendChatAction('typing');

            // 2. Perform Retrieval
            const result = await performLorinRetrieval(msgText, userId, sessionId, history);
            
            // 3. Save Context
            await saveChatMessage(userId, 'user', msgText, sessionId);
            await saveChatMessage(userId, 'assistant', result.answer, sessionId);

            await ctx.reply(result.answer, { parse_mode: 'Markdown' });
        } catch (e: any) {
            console.error('Text Handler Error:', e);
            try { 
                await ctx.reply(`Oof, my brain hit a snag! 🧠💥\n\n**Error:** \`${e.message || 'Unknown Error'}\`\n\nI'm looking into this right now!`); 
            } catch(re) {}
        }
    });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method === 'GET') {
        return res.json({
            status: 'online',
            diagnostics: {
                has_bot: !!bot,
                has_token: !!process.env.TELEGRAM_BOT_TOKEN,
                has_db: !!process.env.DATABASE_URL,
                has_qdrant: !!process.env.QDRANT_URL
            }
        });
    }

    try {
        if (!bot) throw new Error('Telegraf bot not initialized - check environment variables!');
        await bot.handleUpdate(req.body);
        return res.status(200).send('OK');
    } catch (err: any) {
        console.error('CRITICAL HANDLER ERROR:', err);
        
        // Final attempt to report to chat
        try {
            const chatId = req.body?.message?.chat?.id;
            if (chatId && bot) {
                await bot.telegram.sendMessage(chatId, `⚠️ **System Diagnostic**\n\nLorin is having trouble: \`${err.message}\``);
            }
        } catch (e) {}

        return res.status(200).send('OK with errors');
    }
}
