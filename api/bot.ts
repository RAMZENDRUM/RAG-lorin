import { Bot, webhookCallback } from 'grammy';
import { generateText, embed } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { QdrantClient } from '@qdrant/js-client-rest';
import postgres from 'postgres';
import dotenv from 'dotenv';

dotenv.config();

// --- INFRA CONFIG ---
const COLLECTION_NAME = 'lorin_msajce_knowledge';
const qdrant = new QdrantClient({
    url: process.env.QDRANT_URL,
    apiKey: process.env.QDRANT_API_KEY
});

// Database (Supabase) - used for Memory AND Secondary RAG
const sql = postgres(process.env.DATABASE_URL || '', { ssl: 'require' });

const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN || '');

function getOpenAI() {
    const key = process.env.VERCEL_AI_KEY || process.env.OPENAI_API_KEY;
    const isVercelGateway = key?.startsWith('vck_');
    return createOpenAI({ 
        apiKey: key,
        baseURL: isVercelGateway ? 'https://ai-gateway.vercel.sh/v1' : undefined
    });
}

// --- HYDRA SEARCH (Qdrant + Supabase Fallback) ---
async function hydraRetrieve(query: string, embedding: number[], openai: any) {
    console.log(`🔍 Hydra Search: ${query}`);
    
    // 1. PRIMARY: Qdrant
    const qResults = await qdrant.search(COLLECTION_NAME, { vector: embedding, limit: 5, with_payload: true });
    const bestQScore = qResults[0]?.score || 0;
    
    // 2. SECONDARY: Supabase (if score < 0.7)
    if (bestQScore < 0.7) {
        console.log(`⚠️ Low Qdrant Score (${bestQScore}). Triggering Supabase Fallback...`);
        try {
            const sResults = await sql`
                SELECT content, metadata, 1 - (embedding <=> ${`[${embedding.join(',')}]`}) as score
                FROM lorin_knowledge
                ORDER BY score DESC
                LIMIT 5
            `;
            if (sResults.length > 0 && sResults[0].score > bestQScore) {
                console.log(`✅ Supabase found better results! Score: ${sResults[0].score}`);
                return sResults.map(r => r.content).join('\n\n');
            }
        } catch (e) {
            console.error('Supabase RAG Failed:', e);
        }
    }

    return qResults.map(r => r.payload?.content).join('\n\n');
}

// --- BOT HANDLER ---
bot.on('message:text', async (ctx) => {
    const userId = ctx.from.id.toString();
    const text = ctx.message.text;
    await ctx.replyWithChatAction('typing');

    try {
        const openai = getOpenAI();

        // 1. HISTORY (From Supabase)
        const history = await sql`SELECT role, content FROM chat_history WHERE user_id = ${userId} ORDER BY created_at DESC LIMIT 4`.then(rows => rows.reverse());

        // 2. EMBEDDING
        const { embedding } = await embed({ model: openai.embedding('text-embedding-3-small'), value: text });

        // 3. HYDRA RETRIEVAL (Qdrant -> Supabase)
        const context = await hydraRetrieve(text, embedding, openai);

        // 4. GENERATION
        const { text: answer } = await generateText({
            model: openai('gpt-4o-mini'),
            system: `You are Lorin, the smart MSAJCE AI Concierge. Facts: Principal=Dr. K. S. Srinivasan. Admin=Mr. Abdul Gafoor. Use provided context. Bold Headers, bullet points.`,
            prompt: `Context:\n${context}\n\nUser: ${text}`
        });

        // 5. SAVE & REPLY
        await sql`INSERT INTO chat_history (user_id, role, content) VALUES (${userId}, 'user', ${text}), (${userId}, 'assistant', ${answer})`;
        await ctx.reply(answer, { parse_mode: 'Markdown' });

    } catch (err: any) {
        console.error('Hydra Error:', err.message);
        await ctx.reply("📡 I'm fine-tuning my dual-search engine. Give me a moment and ask again! ✨");
    }
});

export default async function handler(req: any, res: any) {
    if (req.method === 'POST') {
        return webhookCallback(bot, 'https')(req, res);
    }
    res.status(200).send('Lorin Hydra: ONLINE 🟢');
}
