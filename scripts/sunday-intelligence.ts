import postgres from 'postgres';
import dotenv from 'dotenv';
import { Telegraf } from 'telegraf';
import fs from 'fs-extra';
import path from 'path';

dotenv.config();

const sql = postgres(process.env.DATABASE_URL!, { ssl: 'require' });
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!);
const ADMIN_ID = "6004664402"; // Your Telegram ID for reporting

async function generateSundayReport() {
    console.log('🚀 Generating Sunday Intelligence Report...');
    
    try {
        // 1. Fetch Weekly Feedback & Intelligence Gaps
        const feedback = await sql`
            SELECT reaction, query, response, created_at 
            FROM audit_feedback 
            WHERE created_at > NOW() - INTERVAL '7 days'
            ORDER BY created_at DESC
        `;

        // 2. Fetch Entity Changes
        const entities = await sql`
            SELECT name, role, department, created_at 
            FROM msajce_entities 
            WHERE created_at > NOW() - INTERVAL '7 days'
        `;

        // 3. Fetch Quota Analytics
        const quotaStats = await sql`
            SELECT COUNT(*) as limited_users 
            FROM rate_limits 
            WHERE minute_count > 5 OR day_count > 30
        `;

        // 4. Build Markdown Summary
        const liked = feedback.filter(f => !f.reaction.includes('UNWANTED')).length;
        const disallowed = feedback.filter(f => f.reaction.includes('UNWANTED')).length;
        const gaps = feedback.filter(f => f.response.includes('don\'t have') || f.response.includes('information missing')).length;
        
        let reportMd = `# 📊 Lorin Strategic Intelligence Report\n\n`;
        reportMd += `**Week Ending:** ${new Date().toLocaleDateString()}\n`;
        reportMd += `**Infrastructure Status:**\n`;
        reportMd += `- 🛡️ Rate-Limited Users: ${quotaStats[0].limited_users}\n`;
        reportMd += `- 🏛️ New Entities Indexed: ${entities.length}\n\n`;

        reportMd += `**Conversation Performance:**\n`;
        reportMd += `- ✅ High Fidelity (👍): ${liked}\n`;
        reportMd += `- ⚠️ Intelligence Gaps (Hallucination Guard): ${gaps}\n`;
        reportMd += `- 🔴 Interaction Failures (👎): ${disallowed}\n\n`;
        
        reportMd += `### 🕵️‍♂️ Key Knowledge Gaps (Need Ingestion):\n`;
        feedback.filter(f => f.response.includes('don\'t have') || f.response.includes('information missing')).slice(0, 5).forEach(f => {
            reportMd += `- Query: "${f.query}"\n`;
        });
        
        reportMd += `\n### 🚩 Top Unwanted Responses:\n`;
        feedback.filter(f => f.reaction.includes('UNWANTED')).slice(0, 5).forEach(f => {
            reportMd += `- Reason: ${f.reaction}\n  Query: "${f.query}"\n\n`;
        });

        // 5. Save Artifacts
        const feedbackFile = path.join(process.cwd(), 'logs', 'Weekly_Audit.csv');
        await fs.ensureDir(path.join(process.cwd(), 'logs'));
        
        let feedbackCsv = "reaction,query,response,date\n";
        feedback.forEach(f => {
            feedbackCsv += `"${f.reaction}","${f.query.replace(/"/g, '""')}","${f.response.replace(/"/g, '""')}","${f.created_at}"\n`;
        });
        await fs.writeFile(feedbackFile, feedbackCsv);

        // 6. Dispatch to Admin (Ramanathan S)
        await bot.telegram.sendMessage(ADMIN_ID, reportMd, { parse_mode: 'Markdown' });
        await bot.telegram.sendDocument(ADMIN_ID, { source: feedbackFile, filename: `Weekly_Audit_${new Date().toISOString().split('T')[0]}.csv` });

        console.log('✅ Strategic Sunday Dispatch Complete.');
        
    } catch (err) {
        console.error('🔴 Strategic Reporting Failed:', err);
    } finally {
        await sql.end();
        process.exit(0);
    }
}

generateSundayReport();
