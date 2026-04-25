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
        // 1. Fetch Weekly Feedback & Interaction Data
        const feedback = await sql`
            SELECT reaction, query, response, created_at 
            FROM audit_feedback 
            WHERE created_at > NOW() - INTERVAL '7 days'
            ORDER BY created_at DESC
        `;

        // 2. Fetch Entity Intelligence Feed
        const entities = await sql`
            SELECT name, role, department, created_at 
            FROM msajce_entities 
            WHERE created_at > NOW() - INTERVAL '7 days'
            ORDER BY created_at DESC
        `;

        // 3. Build Markdown Strategic Summary
        const liked = feedback.filter(f => !f.reaction.includes('UNWANTED')).length;
        const disallowed = feedback.filter(f => f.reaction.includes('UNWANTED')).length;
        const gaps = feedback.filter(f => f.response.includes('don\'t have') || f.response.includes('information missing')).length;
        
        let reportMd = `# 📊 Lorin Strategic Intelligence Report\n\n`;
        reportMd += `**Week Ending:** ${new Date().toLocaleDateString()}\n`;
        reportMd += `**Total Weekly Volume:** ${feedback.length} Queries\n\n`;

        reportMd += `### 🛡️ Auditor Presence\n`;
        reportMd += `- ✅ Satisfied (👍): ${liked}\n`;
        reportMd += `- ⚠️ Intelligence Gaps: ${gaps}\n`;
        reportMd += `- 🔴 Failed Interactions (👎): ${disallowed}\n\n`;

        reportMd += `### 🏛️ Intelligence Feed (New Data)\n`;
        if (entities.length > 0) {
            entities.slice(0, 10).forEach(e => {
                reportMd += `- ${e.name} (${e.role} - ${e.department})\n`;
            });
        } else {
            reportMd += `_No new entities indexed this week._\n`;
        }
        
        reportMd += `\n### 💬 Interaction Feed (Audit)\n`;
        reportMd += `**Top Queries & Intent:**\n`;
        feedback.slice(0, 5).forEach(f => {
            reportMd += `- Q: "${f.query}"\n  Status: ${f.reaction.includes('UNWANTED') ? '🔴' : '✅'}\n`;
        });
        
        if (disallowed > 0) {
            reportMd += `\n**Critical Failures (Audit Needed):**\n`;
            feedback.filter(f => f.reaction.includes('UNWANTED')).slice(0, 5).forEach(f => {
                reportMd += `- Q: "${f.query}"\n  Reason: ${f.reaction}\n`;
            });
        }

        // 4. Save Audit Logs
        const feedbackFile = path.join(process.cwd(), 'logs', 'Weekly_Audit.csv');
        await fs.ensureDir(path.join(process.cwd(), 'logs'));
        
        let feedbackCsv = "reaction,query,response,date\n";
        feedback.forEach(f => {
            feedbackCsv += `"${f.reaction}","${f.query.replace(/"/g, '""')}","${f.response.replace(/"/g, '""')}","${f.created_at}"\n`;
        });
        await fs.writeFile(feedbackFile, feedbackCsv);

        // 5. Dispatch to Admin (Ramanathan S)
        await bot.telegram.sendMessage(ADMIN_ID, reportMd, { parse_mode: 'Markdown' });
        await bot.telegram.sendDocument(ADMIN_ID, { source: feedbackFile, filename: `Audit_Detailed_${new Date().toISOString().split('T')[0]}.csv` });

        console.log('✅ Pillar-Based Dispatch Complete.');
        
    } catch (err) {
        console.error('🔴 Strategic Reporting Failed:', err);
    } finally {
        await sql.end();
        process.exit(0);
    }
}

generateSundayReport();
