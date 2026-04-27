// @ts-ignore
import { default as postgres } from 'postgres';
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

    const update = req.body;
    console.log(`📩 Incoming Update ID: ${update?.update_id || 'UNKNOWN'}`);
    console.time('Full-Processing');

    try {
        if (!update) return res.status(200).send('OK');

        // Stage -2: Reaction Awareness (Feedback Loop)
        if (update.message_reaction) {
            console.log('🎭 Reaction detected');
            const reaction = update.message_reaction;
            const chatId = reaction.chat.id;
            const isPositive = reaction.new_reaction.some((r: any) => r.emoji === '👍' || r.emoji === '🔥' || r.emoji === '❤️');
            
            const feedbackMsg = isPositive 
                ? "Glad I could help! your feedback helps me learn faster. 🚀" 
                : "Sorry about that! I'm still learning. feel free to tell me what I missed or use the enquiry form to help me improve.";
                
            const tgUrl = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`;
            await fetch(tgUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: chatId, text: feedbackMsg })
            });

            // Log reaction to DB (Forensics)
            await sql`UPDATE audit_feedback SET reaction = ${isPositive ? 'LIKED' : 'DISLIKED'} WHERE user_id = ${chatId.toString()} ORDER BY created_at DESC LIMIT 1`;
            return res.status(200).send('OK');
        }

        if (!update.message) return res.status(200).send('OK');
        
        const message = update.message;
        const userId = message.from?.id?.toString();
        const rawText = message.text || "";
        
        if (!userId || !rawText) {
            console.warn('⚠️ Malformed Message: Missing userId or text');
            return res.status(200).send('OK');
        }

        console.log(`👤 User: ${userId} | Query: "${rawText.substring(0, 50)}..."`);

        // Stage 0: Neural Context & Quota Management
        console.time('Quota-Check');
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
                console.warn(`🛑 Rate limit hit for ${userId}`);
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
                console.timeEnd('Quota-Check');
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
        console.timeEnd('Quota-Check');

        // Stage 1: Memory Load
        console.time('Memory-Load');
        let shortTerm = [];
        let profile: any = { user_id: userId, name: null, last_seen: new Date() };

        try {
            const memory = await fetchMemory(userId, sql);
            shortTerm = memory.shortTerm || [];
            profile = memory.profile || profile;
        } catch (memErr) {
            console.warn('⚠️ Memory Load Failed:', memErr);
        }
        console.timeEnd('Memory-Load');

        // Stage 2: Brain Execution (Orchestration)
        console.time('Brain-Orchestration');
        const { answer, metadata } = await orchestrate(
            userId,
            rawText,
            shortTerm,
            profile,
            sql
        );
        console.timeEnd('Brain-Orchestration');

        // Stage 3: Database Logging (Non-blocking)
        console.time('DB-Audit-Sync');
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
                    ${metadata.intent || 'general'}, ${metadata.retrieval_source || 'None'}, ${metadata.latency_ms || 0}, ${metadata.match_score || 0}, ${metadata.model_id || 'unknown'}
                )
            `;
        } catch (dbErr) {
            console.warn('⚠️ DB Sync Failed:', dbErr);
        }
        console.timeEnd('DB-Audit-Sync');

        // Stage 4: Direct Telegram Dispatch
        console.time('Telegram-Dispatch');
        const tgUrl = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`;
        const dispatchResponse = await fetch(tgUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: userId,
                text: answer,
                parse_mode: 'Markdown'
            })
        });
        
        if (!dispatchResponse.ok) {
            const errText = await dispatchResponse.text();
            console.error(`❌ Telegram Dispatch Failed: ${errText}`);
            throw new Error(`Telegram API responded with ${dispatchResponse.status}`);
        }
        console.timeEnd('Telegram-Dispatch');

        console.timeEnd('Full-Processing');
        return res.status(200).send('OK');

    } catch (err: any) {
        console.timeEnd('Full-Processing');
        console.error('❌ CRITICAL ENGINE FAILURE:', err);
        
        // Notify User of Failure
        try {
            const userId = update.message?.from?.id;
            if (userId) {
                const tgUrl = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`;
                await fetch(tgUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chat_id: userId,
                        text: "🚨 *Lorin System Update*\nI'm currently experiencing a high-latency spike or a neural connection issue. My team has been notified. Please try again in a few minutes!",
                        parse_mode: 'Markdown'
                    })
                });
            }
        } catch (notifyErr) {
            console.error('❌ Could not notify user of failure:', notifyErr);
        }

        return res.status(200).send('ERROR_LOGGED');
    }
}
