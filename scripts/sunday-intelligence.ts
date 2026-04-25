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
        // 1. Fetch Weekly Feedback
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

        // 3. Build Markdown Summary
        const liked = feedback.filter(f => !f.reaction.includes('UNWANTED')).length;
        const disliked = feedback.filter(f => f.reaction.includes('UNWANTED')).length;
        
        let reportMd = `# 📊 Lorin Sunday Intelligence Report\n\n`;
        reportMd += `**Date:** ${new Date().toLocaleDateString()}\n`;
        reportMd += `**Weekly Performance:**\n`;
        reportMd += `- ✅ Satisfied Responses (👍): ${liked}\n`;
        reportMd += `- ⚠️ Unwanted Responses (👎/💩): ${disliked}\n`;
        reportMd += `- 🏛️ New Entities Added: ${entities.length}\n\n`;
        
        reportMd += `### 🕵️‍♂️ Top Unwanted Queries:\n`;
        feedback.filter(f => f.reaction.includes('UNWANTED')).slice(0, 5).forEach(f => {
            reportMd += `- Query: "${f.query}"\n  Reason: ${f.reaction}\n\n`;
        });

        // 4. Save CSVs for detailed review
        const feedbackFile = path.join(process.cwd(), 'logs', 'Weekly_Feedback.csv');
        const entityFile = path.join(process.cwd(), 'logs', 'Weekly_Entities.csv');
        
        await fs.ensureDir(path.join(process.cwd(), 'logs'));
        
        // Simple CSV Header
        let feedbackCsv = "reaction,query,response,date\n";
        feedback.forEach(f => {
            feedbackCsv += `"${f.reaction}","${f.query.replace(/"/g, '""')}","${f.response.replace(/"/g, '""')}","${f.created_at}"\n`;
        });
        await fs.writeFile(feedbackFile, feedbackCsv);

        let entityCsv = "name,role,department,date\n";
        entities.forEach(e => {
            entityCsv += `"${e.name}","${e.role}","${e.department}","${e.created_at}"\n`;
        });
        await fs.writeFile(entityFile, entityCsv);

        // 5. Dispatch to Admin via Telegram
        await bot.telegram.sendMessage(ADMIN_ID, reportMd, { parse_mode: 'Markdown' });
        await bot.telegram.sendDocument(ADMIN_ID, { source: feedbackFile, filename: 'Weekly_Feedback_Detailed.csv' });
        await bot.telegram.sendDocument(ADMIN_ID, { source: entityFile, filename: 'Weekly_Entities_ChangeLog.csv' });

        console.log('✅ Sunday Dispatch Complete.');
        
    } catch (err) {
        console.error('🔴 Reporting Pipeline Failed:', err);
    } finally {
        await sql.end();
        process.exit(0);
    }
}

generateSundayReport();
