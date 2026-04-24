import { Bot, webhookCallback } from 'grammy';
import { generateText, embed } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { QdrantClient } from '@qdrant/js-client-rest';
import postgres from 'postgres';

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) throw new Error('TELEGRAM_BOT_TOKEN is required');

const bot = new Bot(token);

// --- LAZY INITIALIZERS (Ensures no crashes at the top level) ---
let sql: any = null;
function getSql() {
    if (!sql && process.env.DATABASE_URL) {
        sql = postgres(process.env.DATABASE_URL, { ssl: 'require', connect_timeout: 5 });
    }
    return sql;
}

function getOpenAI() {
    const key = process.env.VERCEL_AI_KEY || process.env.OPENAI_API_KEY;
    const isVercelGateway = key?.startsWith('vck_');
    return createOpenAI({ 
        apiKey: key,
        baseURL: isVercelGateway ? 'https://ai-gateway.vercel.sh/v1' : undefined
    });
}

// --- HYDRA SEARCH ---
async function hydraSearch(text: string, openai: any) {
    try {
        const qdrant = new QdrantClient({ url: process.env.QDRANT_URL as string, apiKey: process.env.QDRANT_API_KEY as string });
        const { embedding } = await embed({ model: openai.embedding('text-embedding-3-small'), value: text });
        
        const qResults = await qdrant.search('lorin_msajce_knowledge', { vector: embedding, limit: 3, with_payload: true });
        return qResults.map(r => r.payload?.content).join('\n\n');
    } catch (e) {
        console.error('RAG Fallback...');
        return "Internal Document: [MSAJCE College Knowledge Base]";
    }
}

// --- BOT HANDLER ---
bot.on('message:text', async (ctx) => {
    const text = ctx.message.text;
    await ctx.replyWithChatAction('typing');

    try {
        const openai = getOpenAI();
        const db = getSql();

        // 1. MEMORY (Lazy)
        let context = "";
        try {
            context = await hydraSearch(text, openai);
        } catch (e) { console.log('Search skip'); }

        // 2. GENERATE
        const { text: answer } = await generateText({
            model: openai('gpt-4o-mini'),
            system: "You are Lorin, the smart MSAJCE AI. Principal=Dr. K. S. Srinivasan. Admin=Abdul Gafoor. Use provided context.",
            prompt: `Context:\n${context}\n\nUser: ${text}`
        });

        // 3. REPLY
        await ctx.reply(answer, { parse_mode: 'Markdown' });

    } catch (err: any) {
        console.error('Final Fail:', err.message);
        await ctx.reply("✨ Lorin is briefly refreshing her database! Try asking that again.");
    }
});

export default async function handler(req: any, res: any) {
    if (req.method === 'POST') {
        return webhookCallback(bot, 'https')(req, res);
    }
    res.status(200).send('Lorin Bulletproof: READY 🟢');
}
