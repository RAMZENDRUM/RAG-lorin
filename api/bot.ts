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

const GOOGLE_FORM_URL = "https://forms.gle/CTuZcJpQsPsLn7nu8";

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

        // 1. History & Link Counter
        const history = db ? await db`SELECT role, content FROM chat_history WHERE user_id = ${userId} ORDER BY created_at DESC LIMIT 15`.then(rows => rows.reverse()) : [];
        const formCount = history.filter(h => h.role === 'assistant' && h.content.includes(GOOGLE_FORM_URL)).length;

        // 2. Retrieval
        const context = await hydraRetrieve(text, openai);

        // 3. Response Generation (Persona: ChatGPT-like Friend)
        const { text: answer } = await generateText({
            model: openai('gpt-4o-mini'),
            system: `You are Lorin, the lively and friendly AI Concierge for Mohamed Sathak A.J. College of Engineering (Chennai). 
            
            PERSONALITY:
            - Talk like a supportive campus friend. Use emojis! ✨
            - DO NOT repeat "Welcome". Greet only once.
            - If it's a first hi, introduce categories: Admission, Departments, Hostel, Faculty.
            
            RULES:
            - Location: Siruseri, Chennai ONLY.
            - Admissions: If asked about admissions/joining, explain the process AND mention the Google Form. 
            - Form Link Rule: Do NOT include the link if you've already shared it too much in this session.
            - Be concise but conversational.`,
            prompt: `History: ${JSON.stringify(history)}\nContext: ${context}\nUser: ${text}`
        });

        // 4. Smart Form Insertion (Max 3 times per session logic)
        let finalReply = answer;
        if ((text.toLowerCase().includes('admiss') || text.toLowerCase().includes('join')) && formCount < 3 && !answer.includes(GOOGLE_FORM_URL)) {
            finalReply += `\n\n📝 **Ready to join us?** Fill the form here: ${GOOGLE_FORM_URL}`;
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
