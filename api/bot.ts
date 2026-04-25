import postgres from 'postgres';
import { 
    getDynamicAIClient,
    classifyIntent, 
    fetchMemory, 
    orchestrate 
} from '../lib/core/orchestrator.js';

// Initialize Cloud Database
const sql = postgres(process.env.DATABASE_URL!, { ssl: 'require' });

/**
 * TELEGRAM BOT WEBHOOK HANDLER
 */
export default async function handler(req: any, res: any) {
    if (req.method !== 'POST') {
        return res.status(200).send('Lorin Intelligence Node is Online.');
    }

    try {
        const update = req.body;
        if (!update || !update.message) return res.status(200).send('OK');
        
        const message = update.message;
        const userId = message.from.id.toString();
        const rawText = message.text || "";
        const updateId = update.update_id.toString();

        if (!rawText) return res.status(200).send('OK');

        // Stage -1: Identity Injection Stage (Hard-Coded Alpha Profile)
        const devKeywords = /ram|ramanathan|developer|creator|architect/i;
        let alphaContext = "";
        if (devKeywords.test(rawText)) {
            alphaContext = `[ALPHA PROFILE]: Name: Ramanathan S | Creation: Lorin RAG System | LinkedIn: https://www.linkedin.com/in/ramanathan-s-76a0a02b1 | Portfolio: https://ram-ai-portfolio.vercel.app | Email: ramanathanb86@gmail.com\n\n`;
        }

        // Stage 0: Neural Context Loading
        const openai = getDynamicAIClient();
        let shortTerm = [];
        let profile: any = { user_id: userId, name: null, last_seen: new Date() };

        try {
            const memory = await fetchMemory(userId, sql);
            shortTerm = memory.shortTerm || [];
            profile = memory.profile || profile;
        } catch (memErr) {
            console.warn('⚠️ Memory Load Failed:', memErr);
        }

        // Stage 1: Brain Execution
        const intent = await classifyIntent(rawText, openai);
        const { answer } = await orchestrate(
            rawText,
            intent,
            shortTerm,
            profile,
            openai,
            sql,
            updateId,
            alphaContext
        );

        // Stage 6: Database Logging (Non-blocking)
        try {
            await sql`INSERT INTO chat_history (user_id, role, content) VALUES (${userId}, 'user', ${rawText})`;
            await sql`INSERT INTO chat_history (user_id, role, content) VALUES (${userId}, 'assistant', ${answer})`;
        } catch (dbErr) {
            console.warn('⚠️ DB Sync Failed:', dbErr);
        }

        // Stage 7: Direct Telegram Dispatch
        const tgUrl = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`;
        await fetch(tgUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: userId,
                text: answer,
                parse_mode: 'Markdown'
            })
        });

        return res.status(200).send('OK');

    } catch (err: any) {
        console.error('❌ CRITICAL ENGINE FAILURE:', err);
        return res.status(200).send('ERROR_LOGGED');
    }
}
