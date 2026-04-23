import { Telegraf } from 'telegraf';
import { performLorinRetrieval } from '../lib/retrieve.js';
import dotenv from 'dotenv';

dotenv.config();

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

if (!BOT_TOKEN) {
    console.error('TELEGRAM_BOT_TOKEN is missing');
    process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

console.log('🤖 INITIALIZING LORIN...');

bot.start((ctx) => ctx.reply('Welcome to Lorin!'));

const userLimits = new Map<number, { countMin: number, countDay: number, resetMin: number, resetDay: number, isToxic: boolean }>();
const userSessions = new Map<number, { role: 'user' | 'assistant', content: string }[]>();
const userLastMsg = new Map<number, { text: string, count: number }>();
const userSuspensions = new Map<number, number>(); // userId -> reset time
const bannedUsers = new Set<number>();

bot.on('text', async (ctx) => {
    try {
        const username = ctx.from?.username?.toLowerCase() || '';
        const userId = ctx.from?.id;
        const msgText = ctx.message.text;

        // Check permanent ban
        if (bannedUsers.has(userId)) return;

        // Check 1-hour suspension
        const suspension = userSuspensions.get(userId);
        if (suspension && Date.now() < suspension) return;

        // Repetition check (5 times same message = 1 hour ban)
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

        // Rate limit & Toxicity logic
        if (username !== 'zendrum' && username !== 'zendrum_') {
            const now = Date.now();
            let limits = userLimits.get(userId);
            if (!limits) {
                limits = { countMin: 0, countDay: 0, resetMin: now + 60000, resetDay: now + 86400000, isToxic: false };
            }

            // Toxicity Detection
            const toxicKeywords = ['waste', 'better than', 'bad', 'worst', 'abusing', 'spam'];
            if (toxicKeywords.some(k => msgText.toLowerCase().includes(k))) {
                limits.isToxic = true;
            }

            if (now > limits.resetMin) { limits.countMin = 0; limits.resetMin = now + 60000; }
            if (now > limits.resetDay) { limits.countDay = 0; limits.resetDay = now + 86400000; }

            if (limits.countMin >= 5) {
                limits.isToxic = true;
                bannedUsers.add(userId);
                userLimits.set(userId, limits);
                return ctx.reply("Wow, you type fast! Too bad your brain can't keep up. You've officially spammed your way into my blocklist. Goodbye forever! 👋🗑️");
            }

            if (limits.countDay >= 25) {
                return ctx.reply("Look at you, asking 25 questions in one day. Take a break, go outside, maybe read a book. See you tomorrow (if I feel like it). 😴");
            }

            limits.countMin++;
            limits.countDay++;
            userLimits.set(userId, limits);
        }

        // Context / History
        let history = userSessions.get(userId) || [];
        const sessionId = `tg_${userId}_${Math.floor(Date.now() / 3600000)}`; // Hour-based session
        
        // Show typing indicator
        await ctx.sendChatAction('typing');

        const result = await performLorinRetrieval(msgText, userId, sessionId, history);
        
        // Update history
        history.push({ role: 'user', content: ctx.message.text });
        history.push({ role: 'assistant', content: result.answer });
        
        // Keep only last 4 turns (8 messages)
        if (history.length > 8) history = history.slice(-8);
        userSessions.set(userId, history);

        await ctx.reply(result.answer, { parse_mode: 'Markdown' });
    } catch (e) {
        console.error(e);
    }
});

console.log('🚀 ATTEMPTING LAUNCH...');
bot.launch()
    .then(() => console.log('✅ BOT IS RUNNING ON TELEGRAM'))
    .catch(err => console.error('❌ LAUNCH ERROR:', err));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
