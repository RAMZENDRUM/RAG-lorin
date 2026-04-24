import fs from 'fs-extra';
import path from 'path';
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

const LOG_FILE = path.join(process.cwd(), 'logs', 'audit.jsonl');
const RECIPIENT = 'ramzendrum@gmail.com';

async function generateReports() {
    if (!await fs.pathExists(LOG_FILE)) {
        console.error('No logs found to report.');
        return;
    }

    const rawLogs = (await fs.readFile(LOG_FILE, 'utf-8'))
        .split('\n')
        .filter(line => line.trim())
        .map(line => {
            try { return JSON.parse(line); } catch(e) { return null; }
        })
        .filter(Boolean);

    // 1. ADVANCED METRIC CALCULATION
    const totalUsers = new Set(rawLogs.map(l => l.userId)).size;
    const highIntentUsers = new Set(rawLogs.filter(l => l.outcome === 'High Intent').map(l => l.userId)).size;
    const failedQueries = rawLogs.filter(l => l.isFailure);
    const negativeQueries = rawLogs.filter(l => l.isNegative);
    
    // Intent Breakdown
    const intents: Record<string, number> = {};
    rawLogs.forEach(l => intents[l.intent] = (intents[l.intent] || 0) + 1);

    // 2. GENERATE KEY INSIGHTS (The Powerful Part)
    const insights = [
        `🔥 USERS: Total ${totalUsers} unique users interacted this week.`,
        `📈 INTENT: ${((highIntentUsers/totalUsers)*100).toFixed(1)}% of users showed "High Intent" (asked multiple deep questions).`,
        `⚠️ WEAKNESS: System failed to answer ${failedQueries.length} specific queries.`,
        `🛡️ SENTIMENT: ${negativeQueries.length} negative/competitive questions were handled by Marketing Mode.`,
        `🎯 FOCUS: Top intent this week was "${Object.entries(intents).sort((a,b)=>b[1]-a[1])[0]?.[0] || 'N/A'}".`
    ];

    // 3. GENERATE ACTIONS
    const actions = [
        failedQueries.length > 0 ? `🛠️ FIX: Update knowledge base with answers to: "${failedQueries[0]?.query}"` : "🛠️ MAINTAIN: No major data gaps detected.",
        negativeQueries.length > 5 ? "📣 STRATEGY: Update Marketing Mode instructions for competitive placement claims." : "📣 MAINTAIN: General sentiment is positive.",
        "🔄 OPTIMIZE: Review Reranker latency for peak hour traffic."
    ];

    // 4. ASSEMBLE FINAL REPORT
    const reportBody = `
# 🏁 LORIN WEEKLY INTELLIGENCE REPORT

## 📊 CORE STATS
- Total Messages: ${rawLogs.length}
- Avg Engagement: ${(rawLogs.length / totalUsers).toFixed(1)} msgs/user
- Returning Users: ${rawLogs.filter(l => l.engagementScore > 1).length}

## 🔥 KEY INSIGHTS
${insights.join('\n')}

## 🛠️ RECOMMENDED ACTIONS (FIX NEXT WEEK)
${actions.join('\n')}

---
*Lorin RAG Audit Sentinel*
`;

    // 5. SAVE CSV FOR EXCEL ANALYSIS
    const csvData = 'Timestamp,UserID,Intent,Engagement,IsFailure,IsNegative,Query\n' + 
        rawLogs.map(l => `"${l.timestamp}","${l.userId}","${l.intent}",${l.engagementScore},${l.isFailure},${l.isNegative},"${l.query.replace(/"/g, '""')}"`).join('\n');
    
    await fs.ensureDir('logs');
    await fs.writeFile('logs/weekly_audit_detailed.csv', csvData);

    console.log('✅ Weekly analysis complete.');
    await sendEmail(reportBody);
}

async function sendEmail(content: string) {
    const transporter = nodemailer.createTransport({
        host: 'smtp-relay.brevo.com',
        port: 587,
        auth: { user: process.env.BREVO_SMTP_LOGIN, pass: process.env.BREVO_SMTP_KEY }
    });

    try {
        await transporter.sendMail({
            from: '"Lorin Sentinel" <eventbooking.otp@gmail.com>',
            to: RECIPIENT,
            subject: `Lorin Intelligence Report - ${new Date().toLocaleDateString()}`,
            text: content,
            attachments: [{ filename: 'weekly_audit.csv', path: 'logs/weekly_audit_detailed.csv' }]
        });
        console.log('📧 High-impact report emailed to ramzendrum@gmail.com');
    } catch (err) {
        console.error('❌ Email failed:', err);
    }
}

generateReports();
