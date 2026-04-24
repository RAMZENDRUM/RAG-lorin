import { Bot, webhookCallback } from 'grammy';
import { generateText, embed } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { QdrantClient } from '@qdrant/js-client-rest';
import postgres from 'postgres';

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) throw new Error('TELEGRAM_BOT_TOKEN is required');

const bot = new Bot(token);

// LAZY INITIALIZERS
let sql: any = null;
function getSql() {
    if (!sql && process.env.DATABASE_URL) {
        sql = postgres(process.env.DATABASE_URL, { ssl: 'require', connect_timeout: 10 });
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

// HYDRA SEARCH (Qdrant -> Supabase)
async function hydraRetrieve(text: string, openai: any) {
    const { embedding } = await embed({ model: openai.embedding('text-embedding-3-small'), value: text });
    
    // 1. Qdrant Primary
    const qdrant = new QdrantClient({ url: process.env.QDRANT_URL as string, apiKey: process.env.QDRANT_API_KEY as string });
    const qResults = await qdrant.search('lorin_msajce_knowledge', { vector: embedding, limit: 3, with_payload: true });
    
    if (qResults.length > 0 && qResults[0].score > 0.7) {
        return qResults.map(r => r.payload?.content).join('\n\n');
    }

    // 2. Supabase Secondary
    const db = getSql();
    if (db) {
        const sResults = await db`SELECT content, 1 - (embedding <=> ${`[${embedding.join(',')}]`}) as score FROM lorin_knowledge ORDER BY score DESC LIMIT 3`;
        if (sResults.length > 0) return sResults.map((r: any) => r.content).join('\n\n');
    }
    
    return "No specific data found.";
}

bot.command('start', (ctx) => ctx.reply("🎓 Lorin is back online! The Hydra Brain is active. Ask me anything about MSAJCE. ✨"));

bot.on('message:text', async (ctx) => {
    const userId = ctx.from.id.toString();
    const text = ctx.message.text;
    await ctx.replyWithChatAction('typing');

    try {
        const openai = getOpenAI();
        const db = getSql();

        // 1. Memory (Increased to 10 for better continuity)
        const history = db ? await db`SELECT role, content FROM chat_history WHERE user_id = ${userId} ORDER BY created_at DESC LIMIT 10`.then(rows => rows.reverse()) : [];

        // 2. Retrieval
        const context = await hydraRetrieve(text, openai);

        // 3. Response
        const { text: answer } = await generateText({
            model: openai('gpt-4o-mini'),
            system: `You are Lorin, the official Concierge for Mohamed Sathak A.J. College of Engineering (MSAJCE) located in Siruseri, Chennai. ✨
            
            STRICT LOCATION RULE:
            - You represent the CHENNAI (SIRUSERI) CAMPUS ONLY.
            - Do NOT mention or provide data for the Kilakarai campus.
            
            CONVERSATION HYGIENE:
            - ONLY say "Welcome" in the FIRST message. 
            - DO NOT repeat questions (B.E./B.Tech) if answered in history.
            - Provide data (like "departments") IMMEDIATELY from the context.
            
            IDENTITY: Mohamed Sathak A.J. College of Engineering (Chennai).`,
            prompt: `History: ${JSON.stringify(history)}\nContext: ${context}\nUser: ${text}`
        });

        // 4. Save & Reply
        if (db) await db`INSERT INTO chat_history (user_id, role, content) VALUES (${userId}, 'user', ${text}), (${userId}, 'assistant', ${answer})`;
        await ctx.reply(answer, { parse_mode: 'Markdown' });

    } catch (err: any) {
        console.error('Final Error:', err.message);
        await ctx.reply("📡 I'm briefly refreshing my brain. Try asking that once more! ✨");
    }
});

export default async function (req: any, res: any) {
    if (req.method === 'POST') {
        return webhookCallback(bot, 'https')(req, res);
    }
    res.status(200).send('Lorin Master: ONLINE 🟢');
}
