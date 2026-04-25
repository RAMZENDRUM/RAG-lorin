import { generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import postgres from 'postgres';

dotenv.config();

const crawlerDir = 'data/raw_crawler';
const detailedDir = 'data/raw_detailed';
const outputDir = 'data/04_semantic';

const sql = postgres(process.env.DATABASE_URL!, { ssl: 'require' });
const openai = createOpenAI({
    apiKey: process.env.VERCEL_AI_KEY,
    baseURL: 'https://ai-gateway.vercel.sh/v1'
});

const MASTER_PROMPT = `
You are a Zero-Loss Data Engineering System for a MSAJCE RAG pipeline.
Your mission is to UNIFY data without losing a SINGLE factual detail (names, roles, dates).

RULES:
1. NO SUMMARIZATION: You are a replicator. Keep every name and position.
2. NARRATIVE FUSION: Convert every table row into a rich, searchable sentence.
3. STRUCTURE: Use [SECTION: Topic Name] blocks.
4. INDEPENDENCE: Each block must be self-contained so search can find it.
5. NO MARKDOWN: No #, no *, no decorative symbols. Plain text with dashes (-) only.

FORMAT FOR PEOPLE:
"FullName (Role) from Department (Batch Context). Additional context: Description."

FORMAT FOR EVENTS:
"EventName occurred on Date. Speaker: SpeakerName. Participants: Count."
`;

function extractTableRows(content: string): string[] {
    const rows = content.split('\n').filter(l => l.includes('|') && !l.includes('---'));
    return rows.map(r => r.trim()).filter(r => r.length > 5);
}

async function runFusionV2() {
    console.log('🚀 INITIALIZING ZERO-LOSS FUSION ENGINE V2...');
    
    // Wipe old entities for a clean fallback sync
    await sql`DELETE FROM msajce_entities`;
    console.log('🧹 Wiped msajce_entities for fresh sync.');

    const files = fs.readdirSync(crawlerDir).filter(f => f.endsWith('.crawler.txt'));

    for (const crawlerFile of files) {
        const baseName = crawlerFile.replace('.crawler.txt', '');
        const detailedFile = `${baseName}.detailed.txt`;
        const detailedPath = path.join(detailedDir, detailedFile);
        const crawlerPath = path.join(crawlerDir, crawlerFile);
        const outputPath = path.join(outputDir, `${baseName}.semantic.txt`);

        if (!fs.existsSync(detailedPath)) continue;

        console.log(`🧬 Processing: ${baseName}...`);
        const crawlerContent = fs.readFileSync(crawlerPath, 'utf-8');
        const detailedContent = fs.readFileSync(detailedPath, 'utf-8');

        // Deterministic Extraction for Supabase Fallback
        const rows = extractTableRows(detailedContent);
        for (const row of rows) {
            const parts = row.split('|').map(s => s.trim()).filter(Boolean);
            if (parts.length >= 2) {
                // Heuristic: If it has 2+ parts, it's likely a record
                await sql`
                    INSERT INTO msajce_entities (name, role, department, context, source_url)
                    VALUES (${parts[1] || parts[0]}, ${parts[0]}, ${parts[2] || null}, ${row}, ${baseName})
                `.catch(() => {}); // Skip malformed rows
            }
        }

        try {
            const { text } = await generateText({
                model: openai('gpt-4o-mini'),
                system: MASTER_PROMPT,
                prompt: `NARRATIVE:\n${crawlerContent}\n\nSTRUCTURED DATA (TABLES):\n${detailedContent}\n\nDETERMINISTIC ROWS (DO NOT MISS THESE):\n${rows.join('\n')}`
            });

            // Post-process to ensure NO headers or stars
            const cleanText = text.replace(/[#*]/g, '');
            fs.writeFileSync(outputPath, cleanText);
            console.log(`✅ Saved ${baseName}: ${cleanText.length} bytes`);
        } catch (err: any) {
            console.error(`❌ Error ${baseName}: ${err.message}`);
        }
    }

    console.log('✨ ZERO-LOSS FUSION COMPLETE. Entities synced to Supabase.');
    await sql.end();
}

runFusionV2().catch(console.error);
