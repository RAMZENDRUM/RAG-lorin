import { generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const crawlerDir = 'data/raw_crawler';
const detailedDir = 'data/raw_detailed';
const outputDir = 'data/03_fusion';

const openai = createOpenAI({
    apiKey: process.env.VERCEL_AI_KEY,
    baseURL: 'https://ai-gateway.vercel.sh/v1'
});

const MASTER_PROMPT = `
You are a Data Engineering System for a Retrieval-Augmented Generation (RAG) pipeline.
You will receive TWO TYPES of data from the same source:
1. Narrative text (unstructured, human-readable)
2. Structured data (tables, lists, key-value pairs)

Your task is to MERGE, CLEAN, NORMALIZE, and TRANSFORM them into a unified, high-quality dataset optimized for BOTH:
* semantic search (vector DB)
* keyword search (exact lookup)

PHASE 1: ANALYSIS
1. Identify overlapping information between narrative and structured data
2. Detect: duplicates, conflicting values, partial information.
3. Classify data into: people, events, organizations, features, metadata.

PHASE 2: CLEANING
Remove: navigation menus, repeated headings, irrelevant links, symbols (|, ---, etc.), redundant sentences.
Keep: factual content, names, roles, dates, achievements, descriptions.

PHASE 3: NORMALIZATION
1. Convert tables into readable sentences.
2. Standardize naming (Full names, expanded abbreviations).
3. Merge duplicate info into ONE complete statement.

PHASE 4: DATA FUSION (CRITICAL)
- Combine name + role + department + context into ONE narrative sentence for people.
- Combine description + activities for organizations.
- Combine event name + speaker + date + participants for events.

PHASE 5: STRUCTURED KNOWLEDGE BLOCKS
Output in this format:
[SECTION: <Topic Name>]
* 2–4 sentences explaining ONE idea
* include important keywords naturally
* include names, roles, and numbers when relevant

PHASE 6: KEYWORD + SEMANTIC OPTIMIZATION
Each block MUST: contain natural sentences AND exact keywords.

PHASE 7: CHUNK RULES
- 1 block = 1 topic
- 60–150 words max
- no mixed topics, no raw tables, no incomplete sentences.

PHASE 8: OUTPUT
Return ONLY structured sections. No raw data. No tables. No menus.
`;

async function runFusion() {
    const files = fs.readdirSync(crawlerDir)
        .filter(f => f.endsWith('.crawler.txt'));

    console.log(`🌀 Starting Fusion Engine for ${files.length} files...`);

    for (const crawlerFile of files) {
        const baseName = crawlerFile.replace('.crawler.txt', '');
        const detailedFile = `${baseName}.detailed.txt`;
        const detailedPath = path.join(detailedDir, detailedFile);
        const crawlerPath = path.join(crawlerDir, crawlerFile);
        const outputPath = path.join(outputDir, `${baseName}.fusion.txt`);

        if (fs.existsSync(outputPath)) {
            console.log(`⏩ Skipping ${baseName} (already exists)`);
            continue;
        }

        if (!fs.existsSync(detailedPath)) {
            console.log(`⚠️ Missing detailed file for ${baseName}, skipping...`);
            continue;
        }

        console.log(`🧬 Fusing: ${baseName}...`);

        const crawlerContent = fs.readFileSync(crawlerPath, 'utf-8');
        const detailedContent = fs.readFileSync(detailedPath, 'utf-8');

        try {
            const { text } = await generateText({
                model: openai('gpt-4o-mini'),
                system: MASTER_PROMPT,
                prompt: `NARRATIVE DATA:\n${crawlerContent}\n\nSTRUCTURED DATA:\n${detailedContent}`
            });

            fs.writeFileSync(outputPath, text);
            console.log(`✅ Fused and saved: ${baseName}`);
        } catch (err: any) {
            console.error(`❌ Failed ${baseName}: ${err.message}`);
        }

        // Wait a bit to avoid rate limits
        await new Promise(r => setTimeout(r, 1000));
    }

    console.log('✨ Data Fusion (CKR) process completed!');
}

runFusion().catch(console.error);
