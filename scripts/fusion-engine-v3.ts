import { generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import postgres from 'postgres';

dotenv.config();

const crawlerDir = 'data/raw_crawler';
const detailedDir = 'data/raw_detailed';
const textOnlyDir = 'data/01_text_only';
const outputDir = 'data/04_semantic';

const sql = postgres(process.env.DATABASE_URL!, { ssl: 'require' });
const openai = createOpenAI({
    apiKey: process.env.VERCEL_AI_KEY,
    baseURL: 'https://ai-gateway.vercel.sh/v1'
});

const MASTER_PROMPT = `
You are a Zero-Loss Data Engineering System for a MSAJCE RAG pipeline.
Your mission is to UNIFY data from three sources without losing a SINGLE factual detail (names, roles, dates).

SOURCES:
1. RAW CRAWL: Structural/Header info.
2. DETAILED: Tables and granular data.
3. TEXT-ONLY: Pure narrative context.

RULES:
1. NO SUMMARIZATION: You are a replicator. Keep every name and position.
2. NARRATIVE FUSION: Convert every table row into a rich, searchable sentence.
3. STRUCTURE: Use [SECTION: Topic Name] blocks.
4. INDEPENDENCE: Each block must be self-contained.
5. NO MARKDOWN: No #, no *, no decorative symbols. Plain text with dashes (-) only.

FORMAT FOR PEOPLE:
"FullName (Role) from Department (Batch Context). Additional context: Description."
`;

function extractTableRows(content: string): string[] {
    const rows = content.split('\n').filter(l => l.includes('|') && !l.includes('---'));
    return rows.map(r => r.trim()).filter(r => r.length > 5);
}

async function runFusionV3() {
    console.log('🚀 INITIALIZING TRIPLE-SOURCE FUSION ENGINE...');
    
    await sql`DELETE FROM msajce_entities`;
    console.log('🧹 Wiped msajce_entities for fresh sync.');

    const files = fs.readdirSync(crawlerDir).filter(f => f.endsWith('.crawler.txt'));

    for (const crawlerFile of files) {
        const baseName = crawlerFile.replace('.crawler.txt', '');
        const detailedFile = `${baseName}.detailed.txt`;
        const textFile = `${baseName}.txt`;
        
        const detailedPath = path.join(detailedDir, detailedFile);
        const crawlerPath = path.join(crawlerDir, crawlerFile);
        const textOnlyPath = path.join(textOnlyDir, textFile);
        const outputPath = path.join(outputDir, `${baseName}.semantic.txt`);

        console.log(`🧬 Fusing: ${baseName}...`);
        const crawlerContent = fs.existsSync(crawlerPath) ? fs.readFileSync(crawlerPath, 'utf-8') : '';
        const detailedContent = fs.existsSync(detailedPath) ? fs.readFileSync(detailedPath, 'utf-8') : '';
        const textOnlyContent = fs.existsSync(textOnlyPath) ? fs.readFileSync(textOnlyPath, 'utf-8') : '';

        // Deterministic Extraction for Supabase Fallback
        const rows = extractTableRows(detailedContent);
        for (const row of rows) {
            const parts = row.split('|').map(s => s.trim()).filter(Boolean);
            if (parts.length >= 2) {
                await sql`
                    INSERT INTO msajce_entities (name, role, department, context, source_url)
                    VALUES (${parts[1] || parts[0]}, ${parts[0]}, ${parts[2] || null}, ${row}, ${baseName})
                `.catch(() => {});
            }
        }

        try {
            const { text } = await generateText({
                model: openai('gpt-4o-mini'),
                system: MASTER_PROMPT,
                prompt: `SOURCE A (CRAWLER):\n${crawlerContent}\n\nSOURCE B (DETAILED TABLES):\n${detailedContent}\n\nSOURCE C (PURE TEXT):\n${textOnlyContent}\n\nROWS TO PRESERVE:\n${rows.join('\n')}`
            });

            const cleanText = text.replace(/[#*]/g, '');
            fs.writeFileSync(outputPath, cleanText);
            console.log(`✅ Saved ${baseName}: ${cleanText.length} bytes`);
        } catch (err: any) {
            console.error(`❌ Error ${baseName}: ${err.message}`);
        }
    }

    console.log('🌟 TRIPLE-SOURCE FUSION COMPLETE.');
    await sql.end();
}

runFusionV3().catch(console.error);
