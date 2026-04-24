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
    
    // 1. Qdrant Primary (Increased to 15 chunks)
    const qdrant = new QdrantClient({ url: process.env.QDRANT_URL as string, apiKey: process.env.QDRANT_API_KEY as string });
    const qResults = await qdrant.search('lorin_msajce_knowledge', { vector: embedding, limit: 15, with_payload: true });
    
    if (qResults.length > 0 && qResults[0].score > 0.7) {
        return qResults.map(r => r.payload?.content).join('\n\n');
    }

    // 2. Supabase Secondary (Increased to 10 chunks)
    const db = getSql();
    if (db) {
        const sResults = await db`SELECT content, 1 - (embedding <=> ${`[${embedding.join(',')}]`}) as score FROM lorin_knowledge ORDER BY score DESC LIMIT 10`;
        if (sResults.length > 0) return sResults.map((r: any) => r.content).join('\n\n');
    }
    
    return "No specific data found.";
}

const GOOGLE_FORM_URL = "https://forms.gle/Fto1EWFofwQdnjoz7";

bot.command('start', (ctx) => {
    ctx.reply(`👋 Hey! I'm Lorin, your Mohamed Sathak A.J. (Chennai) campus buddy! 🎓✨\n\nI can help you with:\n🏢 **Departments**\n📝 **Admissions**\n🏠 **Hostels**\n👩‍🏫 **Faculty**\n\nWhat are you looking for today?`, { parse_mode: 'Markdown' });
});

bot.command('form', (ctx) => ctx.reply(`📝 **Admission Form:** ${GOOGLE_FORM_URL}`));

bot.on('message:text', async (ctx) => {
    const userId = ctx.from.id.toString();
    const text = ctx.message.text;
    await ctx.replyWithChatAction('typing');

    try {
        const openai = getOpenAI();
        const db = getSql();

        // 1. History & Time Check
        const history = db ? await db`SELECT role, content, created_at FROM chat_history WHERE user_id = ${userId} ORDER BY created_at DESC LIMIT 20`.then(rows => rows.reverse()) : [];
        
        const lastFormMsg = [...history].reverse().find(h => h.role === 'assistant' && h.content.includes("forms.gle"));
        const lastFormTime = lastFormMsg ? new Date(lastFormMsg.created_at).getTime() : 0;
        const oneHourAgo = Date.now() - (60 * 60 * 1000);

        // 2. Retrieval
        const context = await hydraRetrieve(text, openai);

        // 3. Response Generation (Persona: Master Concierge)
        const { text: answer } = await generateText({
            model: openai('gpt-4o-mini'),
            system: `You are Lorin, the official Concierge for Mohamed Sathak A.J. (Chennai). ✨
            
            CORE IDENTITIES (MUST KNOW):
            - Principal: Dr. K. S. Srinivasan. (Specialist in Optics, Nit Trichy).
            - Admin: Mr. A. Abdul Gafoor (Assistant Transport Convener & AO). 
            - If these names are mentioned, identify them IMMEDIATELY as MSAJCE leadership.
            
            RULES:
            - Admit Link: ${GOOGLE_FORM_URL} (Hourly cooldown).
            - Be a warm, supportive campus friend.
            - Greet only once.`,
            prompt: `History: ${JSON.stringify(history)}\nContext: ${context}\nUser: ${text}`
        });

        // 4. Smart Smart Form Insertion (Logic: Hourly or Force)
        let finalReply = answer;
        const normalizedText = text.toLowerCase();
        const isForceQuery = normalizedText.includes('give me') || normalizedText.includes('send') || normalizedText.includes('where is');
        const isAdmissQuery = normalizedText.includes('admiss') || normalizedText.includes('join') || normalizedText.includes('form');
        
        const cooldownActive = lastFormTime > oneHourAgo;
        const shouldSend = isForceQuery || (isAdmissQuery && !cooldownActive);

        if (shouldSend && !answer.includes(GOOGLE_FORM_URL)) {
            finalReply += `\n\n📝 **Admission Form:** ${GOOGLE_FORM_URL}`;
        }

        // 5. Save & Reply
        if (db) await db`INSERT INTO chat_history (user_id, role, content) VALUES (${userId}, 'user', ${text}), (${userId}, 'assistant', ${finalReply})`;
        await ctx.reply(finalReply, { parse_mode: 'Markdown' });

    } catch (err: any) {
        console.error('Lively Fail:', err.message);
        await ctx.reply("✨ Just taking a quick campus stroll! Ask me again in a second.");
    }
});

export default async function (req: any, res: any) {
    if (req.method === 'POST') {
        return webhookCallback(bot, 'https')(req, res);
    }
    res.status(200).send('Lorin Master: ONLINE 🟢');
}
