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
        const devKeywords = /ram|ramanathan|developer|creator|architect|architect|developed/i;
        let alphaContext = "";
        if (devKeywords.test(rawText)) {
            alphaContext = `[ALPHA PROFILE]: 
            Name: Ramanathan S
            Role: Lead Architect at MSAJCE
            Expertise: RAG System Development, Full-Stack Architecture
            Projects: College Bus Tracking App, Smart Hostel Web App, Lorin RAG
            LinkedIn: https://www.linkedin.com/in/ramanathan-s-76a0a02b1
            Portfolio: https://ram-ai-portfolio.vercel.app
            Email: ramanathanb86@gmail.com
            Tone: Portray him as a visionary student-innovator leading AI projects at MSAJCE.\n\n`;
        }

        // Stage 0: Neural Context & Quota Management
        const openai = getDynamicAIClient();
        const ADMIN_IDS = (process.env.ADMIN_IDS || "").split(",").map(id => id.trim()).filter(Boolean);
        const isDeveloper = ADMIN_IDS.includes(userId);

        if (!isDeveloper) {
            const now = new Date();
            const [quota] = await sql`
                INSERT INTO rate_limits (user_id, last_minute, last_day) 
                VALUES (${userId}, ${now}, ${now})
                ON CONFLICT (user_id) DO UPDATE SET user_id = EXCLUDED.user_id
                RETURNING *
            `;

            const minDiff = (now.getTime() - new Date(quota.last_minute).getTime()) / 60000;
            const dayDiff = (now.getTime() - new Date(quota.last_day).getTime()) / (1000 * 60 * 60 * 24);

            let newMinCount = minDiff > 1 ? 1 : quota.minute_count + 1;
            let newDayCount = dayDiff > 1 ? 1 : quota.day_count + 1;

            if (newMinCount > 5 || newDayCount > 30) {
                const tgUrl = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`;
                await fetch(tgUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chat_id: userId,
                        text: "⚠️ *Community Quota Reached*\nTo ensure stability, I limit usage to 5 queries per minute and 30 per day. Please try again later!",
                        parse_mode: 'Markdown'
                    })
                });
                return res.status(200).send('RATE_LIMITED');
            }

            await sql`
                UPDATE rate_limits SET 
                    minute_count = ${newMinCount}, 
                    day_count = ${newDayCount},
                    last_minute = ${minDiff > 1 ? now : quota.last_minute},
                    last_day = ${dayDiff > 1 ? now : quota.last_day}
                WHERE user_id = ${userId}
            `;
        }

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
        const { answer, metadata } = await orchestrate(
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
            
            // SaaS-Grade Forensic Logging
            await sql`
                INSERT INTO audit_feedback (
                    user_id, query, response, reaction, 
                    intent_category, retrieval_source, latency_ms, match_score, model_id
                ) VALUES (
                    ${userId}, ${rawText}, ${answer}, 'PENDING',
                    ${metadata.intent}, ${metadata.retrieval_source}, ${metadata.latency_ms}, ${metadata.match_score}, ${metadata.model_id}
                )
            `;
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
