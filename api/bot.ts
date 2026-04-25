import { Telegraf } from 'telegraf';
import { 
    classifyIntent, 
    rewriteQuery, 
    hybridRetrieve, 
    rerankResults, 
    agentDecide, 
    buildContext, 
    generateGrounded, 
    postProcess 
} from '../lib/core/orchestrator.js';
import { fetchMemory, updateProfile, extractInterest } from '../lib/core/memory.js';
import type { UserProfile } from '../lib/core/memory.js';
import { createOpenAI } from '@ai-sdk/openai';
import postgres from 'postgres';
import dotenv from 'dotenv';

dotenv.config();

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const DB_URL = process.env.DATABASE_URL;
const GOOGLE_FORM_URL = "https://forms.gle/bx2S4iPtJLipA9866";

// Initialization - Safe Database Handle
let sql: any = null;
if (DB_URL) {
    try {
        sql = postgres(DB_URL, { ssl: 'require' });
        console.log("✅ Database linked successfully.");
        
        // Ensure feedback table exists with query context
        sql`
            CREATE TABLE IF NOT EXISTS audit_feedback (
                id SERIAL PRIMARY KEY,
                user_id TEXT,
                message_id TEXT,
                reaction TEXT,
                query TEXT,
                response TEXT,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );
        `.catch(e => console.error("⚠️ Feedback Table Init Failed:", e));

        // Registry for mapping message IDs to queries (Temporal memory for reactions)
        sql`
            CREATE TABLE IF NOT EXISTS message_registry (
                message_id TEXT PRIMARY KEY,
                query TEXT,
                response TEXT,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );
        `.catch(e => console.error("⚠️ Registry Table Init Failed:", e));

        // Anti-Loop Deduplication Table (The Loop Shield)
        sql`
            CREATE TABLE IF NOT EXISTS processed_updates (
                update_id BIGINT PRIMARY KEY,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );
        `.catch(e => console.error("⚠️ Deduplication Table Init Failed:", e));

        // Management Analytics: Interest Map (What are they looking for?)
        sql`
            CREATE TABLE IF NOT EXISTS analytics_interest (
                id SERIAL PRIMARY KEY,
                department TEXT,
                intent TEXT,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );
        `.catch(e => console.error("⚠️ Interest Table Init Failed:", e));

        // Management Analytics: Knowledge Gaps (What are we missing?)
        sql`
            CREATE TABLE IF NOT EXISTS analytics_gaps (
                id SERIAL PRIMARY KEY,
                query TEXT,
                confidence_score FLOAT,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );
        `.catch(e => console.error("⚠️ Gaps Table Init Failed:", e));

        // Developer Analytics: Performance (How fast/cheap are we?)
        sql`
            CREATE TABLE IF NOT EXISTS audit_performance (
                id SERIAL PRIMARY KEY,
                update_id BIGINT,
                stage_seconds FLOAT,
                intent TEXT,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );
        `.catch(e => console.error("⚠️ Performance Table Init Failed:", e));
        
    } catch (e) {
        console.error("⚠️ Database binding failed:", e);
    }
}

const bot = new Telegraf(BOT_TOKEN!);

// Multi-Key Vercel Helper
function getDynamicAIClient() {
    const VERCEL_KEYS = [
        process.env.VERCEL_AI_KEY,
        process.env.VERCEL_AI_KEY_2,
        process.env.VERCEL_AI_KEY_3,
        process.env.VERCEL_AI_KEY_4
    ].filter(Boolean) as string[];
    
    const activeVercelKey = VERCEL_KEYS[Math.floor(Math.random() * VERCEL_KEYS.length)] || process.env.OPENAI_API_KEY;
    return createOpenAI({
        apiKey: activeVercelKey,
        baseURL: 'https://ai-gateway.vercel.sh/v1'
    });
}

bot.start((ctx) => ctx.reply('Welcome to Lorin! I am your smart MSAJCE Concierge. 🤖\n\n💡 **Tip:** You can like (👍) or dislike (👎) my answers by reacting to them. This helps me improve! How can I help you today?'));

bot.on('text', async (ctx) => {
    const updateId = ctx.update.update_id;
    try {
        const userId = ctx.from.id.toString();
        const rawText = ctx.message.text;

        // Stage 0: Deep Feedback Capture (Detect replies to apologies/feedback requests)
        const isReply = !!ctx.message.reply_to_message;
        const repliedText = (ctx.message.reply_to_message as any)?.text || "";
        const isFeedbackReply = isReply && /sorry|not satisfied|what was wrong|anything missing|helpful/i.test(repliedText);

        if (isFeedbackReply) {
            console.log(`📝 Captured clarification feedback from ${userId}: ${rawText}`);
            if (sql) {
                await sql`
                    INSERT INTO audit_feedback (user_id, reaction, query, response)
                    VALUES (${userId}, 'FEEDBACK_CLARIFICATION', ${rawText}, ${repliedText})
                `;
            }
            return ctx.reply("Thank you for the detailed feedback! I have shared this with my developers to help improve my future answers. 🙏✨");
        }

        // Deduplication Check (Prevent Loops)
        if (sql) {
            const alreadyProcessed = await sql`SELECT update_id FROM processed_updates WHERE update_id = ${updateId}`;
            if (alreadyProcessed.length > 0) return console.log(`⏩ Skipping duplicate update: ${updateId}`);
            
            await sql`INSERT INTO processed_updates (update_id) VALUES (${updateId})`;
        }
        
        // Dynamically instantiate the AI client per message to guarantee rotation
        const openai = getDynamicAIClient();

        // Stage 0: Context (With failure protection)
        let shortTerm = [];
        let profile: UserProfile = { user_id: userId, name: null, interest: null, stage: 'unknown', last_seen: new Date(), strikes: 0, blocked_until: null };
        
        try {
            const memory = await fetchMemory(userId, sql);
            shortTerm = memory.shortTerm;
            profile = memory.profile;
        } catch (memErr) {
            console.warn('⚠️ Memory Fetch Failed (Falling back to local):', memErr);
        }
        
        const startTime = Date.now();
        
        // Stage 1-2: Neural Classification & Expansion
        const intent = await classifyIntent(rawText, openai);
        const rewrittenQuery = rewriteQuery(rawText, intent, profile as any, shortTerm);
        
        // Stage 3-4: Hybrid Search (High-Recall for People)
        const isIdentity = intent === 'faculty' || /who|tell me about|contact|professor|dr\.|mr\./i.test(rawText);
        const chunks = await hybridRetrieve(rewrittenQuery, rawText, openai, sql, isIdentity ? 50 : 15);
        
        // Stage 4.5: Reranking (Get Confidence)
        const { context, topScore } = await rerankResults(rewrittenQuery, chunks, openai);
        
        // Phase 12: Analytics Injection
        if (sql) {
            const processingTimeSec = (Date.now() - startTime) / 1000;
            
            // 1. Interest Map
            const deptRegex = /cse|it|ece|eee|mech|civil|aiml|aids|cyber|csbs/i;
            const detectedDept = rawText.match(deptRegex)?.[0] || 'GENERAL';
            sql`INSERT INTO analytics_interest (department, intent) VALUES (${detectedDept.toUpperCase()}, ${intent})`.catch(() => {});

            // 2. Knowledge Gaps (If rerank score is low)
            if (topScore < 0.5) {
                sql`INSERT INTO analytics_gaps (query, confidence_score) VALUES (${rawText}, ${topScore})`.catch(() => {});
            }

            // 3. Performance (Developer Intel)
            sql`INSERT INTO audit_performance (update_id, stage_seconds, intent) VALUES (${updateId}, ${processingTimeSec}, ${intent})`.catch(() => {});
        }
        
        // Stage 5-6: Framing
        const lastSeenTime = profile.last_seen instanceof Date 
            ? profile.last_seen.getTime() 
            : Date.now();

        const agentFlags = agentDecide(intent, rawText, context, lastSeenTime, GOOGLE_FORM_URL);
        const finalContext = buildContext(context, shortTerm, profile);
        
        // Stage 7-8: Generating & Processing (Personality Layer)
        const answer = await generateGrounded(finalContext, rawText, agentFlags, GOOGLE_FORM_URL, openai);
        const finalOutput = postProcess(answer, agentFlags, GOOGLE_FORM_URL, chunks, rawText);

        // Memory & Audit (Non-Blocking)
        try {
            const newInterest = extractInterest(rawText);
            await updateProfile(userId, { 
                interest: newInterest || profile.interest || undefined,
            }, sql);

            await sql`INSERT INTO chat_history (user_id, role, content) VALUES (${userId}, 'user', ${rawText})`;
            await sql`INSERT INTO chat_history (user_id, role, content) VALUES (${userId}, 'assistant', ${finalOutput})`;
        } catch (dbErr: any) {
            console.warn('⚠️ Database Operation Failed:', dbErr.message);
            // We continue anyway so the user gets an answer
        }

        const botMsg = await ctx.reply(finalOutput, { parse_mode: 'Markdown' });

        // Phase 10: Registry Logging (For reaction context)
        if (sql) {
            await sql`
                INSERT INTO message_registry (message_id, query, response)
                VALUES (${botMsg.message_id.toString()}, ${rawText}, ${finalOutput})
                ON CONFLICT (message_id) DO NOTHING
            `;

            // Phase 11: Text-Emoji Feedback Extraction (Capture 'unwanted' or expressive emojis)
            const emojiRegex = /(\u00a9|\u00ae|[\u2000-\u3300]|\ud83c[\ud000-\udfff]|\ud83d[\ud000-\udfff]|\ud83e[\ud000-\udfff])/g;
            const foundEmojis = rawText.match(emojiRegex);
            if (foundEmojis) {
                for (const em of foundEmojis) {
                    await sql`
                        INSERT INTO audit_feedback (user_id, message_id, reaction, query, response)
                        VALUES (${userId}, ${botMsg.message_id.toString()}, ${'TEXT_EMOJI: ' + em}, ${rawText}, ${finalOutput})
                    `;
                }
            }
        }
    } catch (e: any) {
        console.error('Webhook Orchestration Error:', e);
        try {
            const maskedUrl = DB_URL ? `${DB_URL.split('@')[1]?.split('/')[0] || 'HIDDEN'}` : 'UNDEFINED';
            await ctx.reply(`⚠️ **System Diagnostics Error:**\n\`${e.message || String(e)}\`\n\n**DB Target:** \`${maskedUrl}\``, { parse_mode: 'Markdown' });
        } catch (fallbackErr) {
            console.error('Diagnostic delivery failed', fallbackErr);
        }
    }
});

// Vercel Serverless Handler
export default async function handler(req: any, res: any) {
    if (req.method === 'POST') {
        try {
            await bot.handleUpdate(req.body);
            res.status(200).send('OK');
        } catch (err) {
            console.error(err);
            res.status(500).send('Error');
        }
    } else {
        res.status(200).send('Lorin Webhook is Active 🤖');
    }
}

// Stage 10: Feedback Loop (Reactions)
bot.on('message_reaction', async (ctx) => {
    try {
        const userId = ctx.from?.id.toString();
        const msgId = ctx.messageReaction.message_id.toString();
        const reactions = ctx.messageReaction.new_reaction;
        
        // If the reaction list is empty, it means the user REMOVED their reaction
        if (reactions.length === 0) {
            console.log(`🗑️ Feedback removed by ${userId} for message ${msgId}`);
            if (sql) {
                await sql`DELETE FROM audit_feedback WHERE user_id = ${userId} AND message_id = ${msgId}`;
            }
            return;
        }

        const reaction = reactions[0];
        let reactionType = 'unknown';
        if (reaction && 'emoji' in reaction) reactionType = reaction.emoji;

        console.log(`⭐ Feedback received: ${reactionType}`);

        if (sql && userId) {
            const unwantedEmojis = ['👎', '💩', '🤮', '🤡', '😠', '😡', '😱'];
            const isUnwanted = unwantedEmojis.includes(reactionType);
            const finalTag = isUnwanted ? `UNWANTED_REACTION: ${reactionType}` : reactionType;

            // Fetch query context from registry
            const registry = await sql`SELECT query, response FROM message_registry WHERE message_id = ${msgId} LIMIT 1`;
            const q = registry[0]?.query || 'UNKNOWN_QUERY';
            const r = registry[0]?.response || 'UNKNOWN_RESPONSE';

            await sql`
                INSERT INTO audit_feedback (user_id, message_id, reaction, query, response)
                VALUES (${userId}, ${msgId}, ${finalTag}, ${q}, ${r})
            `;

            // Adaptive Response
            if (isUnwanted) {
                await ctx.reply("I'm sorry! I see you're not satisfied with this answer. 😔 Could you please tell me what was wrong or missing? Your feedback helps me grow smarter!");
            } else {
                await ctx.reply("Thank you for the support! I'm glad I could help. 🙏✨");
            }
        }
    } catch (e) {
        console.error('⚠️ Feedback Capture Failed:', e);
    }
});
