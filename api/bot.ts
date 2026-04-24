import { Bot, webhookCallback } from 'grammy';

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) throw new Error('TELEGRAM_BOT_TOKEN is required');

const bot = new Bot(token);

// ATOMIC LEVEL TEST - ZERO LIBRARIES
bot.on('message:text', async (ctx) => {
    const msg = ctx.message.text.toLowerCase();
    await ctx.reply(`⚛️ Atomic Scan: I am receiving your messages. Text: "${msg}". No AI libraries are active right now. Please tell me if you see this!`);
});

export default async function handler(req: any, res: any) {
    if (req.method === 'POST') {
        return webhookCallback(bot, 'https')(req, res);
    }
    res.status(200).send('Lorin Atomic: ACTIVE ⚛️');
}
