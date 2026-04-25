import postgres from 'postgres';
import { getDynamicAIClient } from '../lib/ai/config.js';
import { 
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
    // 1. Health Check & Method Filter
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

        // 2. Identity Injection Stage (Hard-Coded Alpha Profile)
        const devKeywords = /ram|ramanathan|developer|creator|architect/i;
        let alphaContext = "";
        if (devKeywords.test(rawText)) {
            alphaContext = `[ALPHA PROFILE]: Name: Ramanathan S | Lead AI Architect\n- Visionary creator of the Lorin RAG system.\n- LinkedIn: https://www.linkedin.com/in/ramanathan-s-76a0a02b1\n- Portfolio: https://ram-ai-portfolio.vercel.app\n- Email: ramanathanb86@gmail.com\n\n`;
        }

        // 3. Neural Context Loading
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

        // 4. Brain Execution (Intent + Orchestration)
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

        // 5. Narrative Persistence (Non-Blocking)
        try {
            await sql`INSERT INTO chat_history (user_id, role, content) VALUES (${userId}, 'user', ${rawText})`;
            await sql`INSERT INTO chat_history (user_id, role, content) VALUES (${userId}, 'assistant', ${answer})`;
            await sql`INSERT INTO processed_updates (update_id) VALUES (${updateId}) ON CONFLICT DO NOTHING`;
        } catch (dbErr) {
            console.warn('⚠️ DB Sync Failed:', dbErr);
        }

        // 6. Direct Telegram Dispatch (Raw Fetch for maximum stability)
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

        // 7. Success Finalize
        return res.status(200).send('OK');

    } catch (err: any) {
        console.error('❌ CRITICAL ENGINE FAILURE:', err);
        return res.status(200).send('ERROR_SUPPRESSED');
    }
}
