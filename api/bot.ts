import { Bot, webhookCallback } from 'grammy';

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) throw new Error('TELEGRAM_BOT_TOKEN is required');

const bot = new Bot(token);

// PURE PULSE CHECK - NO DATABASE, NO RAG
bot.command('start', (ctx) => ctx.reply("🟢 Lorin is ALIVE. The bridge is restored. Now I will re-enable the RAG brain."));

bot.on('message:text', async (ctx) => {
    const text = ctx.message.text.toLowerCase();
    
    if (text === 'hi' || text === 'hey' || text === 'ping') {
        return ctx.reply("🎾 Pong! The connection is 100% active. I am ready to re-integrate the MSAJCE knowledge base.");
    }

    // Temporary Fallback
    await ctx.reply("🔄 Connection stable. I am re-linking the campus knowledge base now. Ask me again in 10 seconds!");
});

export default async function handler(req: any, res: any) {
    if (req.method === 'POST') {
        return webhookCallback(bot, 'https')(req, res);
    }
    res.status(200).send('Lorin Pulse: OK 🟢');
}
