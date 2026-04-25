import postgres from 'postgres';
import dotenv from 'dotenv';
import { Telegraf } from 'telegraf';
import fs from 'fs-extra';
import path from 'path';

dotenv.config();

const sql = postgres(process.env.DATABASE_URL!, { ssl: 'require' });
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!);
const ADMIN_ID = (process.env.ADMIN_IDS || "").split(",")[0]; 

async function generateSundayReport() {
    console.log('🚀 Generating Sunday Intelligence Report...');
    
    try {
        // 1. Fetch ALL Forensic Data for the week
        const allData = await sql`
            SELECT * FROM audit_feedback 
            WHERE created_at > NOW() - INTERVAL '7 days'
            ORDER BY created_at DESC
        `;

        // 2. Build Forensics CSV (Raw Log)
        let forensicsCsv = "timestamp,user_id,query,intent_category,retrieval_source,latency_ms,match_score,status\n";
        allData.forEach(row => {
            forensicsCsv += `"${row.created_at}","${row.user_id}","${row.query.replace(/"/g, '""')}","${row.intent_category}","${row.retrieval_source}",${row.latency_ms},${row.match_score},"${row.reaction}"\n`;
        });

        // 3. Build Optimization CSV (Only Failures/Low Scores)
        // Similarity score < 100 or negative feedback
        const weakData = allData.filter(row => row.match_score < 100 || row.reaction.includes('UNWANTED'));
        let optimizationCsv = "unanswered_query,top_match_similarity,intent_category,failure_reason\n";
        weakData.forEach(row => {
            optimizationCsv += `"${row.query.replace(/"/g, '""')}",${row.match_score},"${row.intent_category}","${row.reaction}"\n`;
        });

        // 4. Build Institutional CSV (ROI Summary)
        const totalQueries = allData.length;
        const highConfidence = allData.filter(row => row.match_score > 500).length;
        const deflectionRate = totalQueries > 0 ? ((highConfidence / totalQueries) * 100).toFixed(1) : 0;
        
        let institutionalCsv = "metric,value\n";
        institutionalCsv += `"Total_Weekly_Queries","${totalQueries}"\n`;
        institutionalCsv += `"Human_Deflection_Rate","${deflectionRate}%"\n`;
        institutionalCsv += `"Top_Intent_Category","${allData[0]?.intent_category || 'N/A'}"\n`;
        institutionalCsv += `"Knowledge_Coverage","${deflectionRate}%"\n`;
        
        // 5. Build Markdown Summary for Telegram
        let reportMd = `# 📊 Lorin Triple-Pillar Audit\n\n`;
        reportMd += `**Date:** ${new Date().toLocaleDateString()}\n`;
        reportMd += `**1. 🛡️ Forensics**: Total of ${totalQueries} interactions logged.\n`;
        reportMd += `**2. 🛠️ Optimization**: Found ${weakData.length} areas for RAG improvement.\n`;
        reportMd += `**3. 🏛️ Institutional**: ${deflectionRate}% Human Deflection achieved.\n\n`;
        reportMd += `✅ Dispatched 3 Audit CSVs to Lead Architect.`;

        // 6. Save & Dispatch
        const dir = path.join(process.cwd(), 'logs');
        await fs.ensureDir(dir);
        
        await fs.writeFile(path.join(dir, 'audit_forensics.csv'), forensicsCsv);
        await fs.writeFile(path.join(dir, 'developer_optimization.csv'), optimizationCsv);
        await fs.writeFile(path.join(dir, 'institutional_benefits.csv'), institutionalCsv);

        await bot.telegram.sendMessage(ADMIN_ID, reportMd, { parse_mode: 'Markdown' });
        await bot.telegram.sendDocument(ADMIN_ID, { source: path.join(dir, 'audit_forensics.csv'), filename: 'lorin_audit_forensics.csv' });
        await bot.telegram.sendDocument(ADMIN_ID, { source: path.join(dir, 'developer_optimization.csv'), filename: 'lorin_developer_optimization.csv' });
        await bot.telegram.sendDocument(ADMIN_ID, { source: path.join(dir, 'institutional_benefits.csv'), filename: 'lorin_institutional_benefits.csv' });

        console.log('✅ Triple-Pillar Dispatch Complete.');
        
    } catch (err) {
        console.error('🔴 Strategic Reporting Failed:', err);
    } finally {
        await sql.end();
        process.exit(0);
    }
}

generateSundayReport();
