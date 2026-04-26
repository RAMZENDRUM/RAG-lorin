import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';

dotenv.config();

// AI Key Rotation Setup
const keys = [
    process.env.VERCEL_AI_KEY,
    process.env.VERCEL_AI_KEY_2,
    process.env.VERCEL_AI_KEY_3,
    process.env.VERCEL_AI_KEY_4
].filter(Boolean);

function getClient(attempt: number) {
    const key = keys[attempt % keys.length];
    return createOpenAI({
        apiKey: key,
        baseURL: "https://ai-gateway.vercel.sh/v1"
    });
}

async function neuralCleanup() {
    console.log('🧠 Starting Neural Entity Audit (with Key Rotation)...');
    
    const sourcePath = path.join(process.cwd(), 'data', 'backups', 'msajce_entities_full_export.json');
    const outputPath = path.join(process.cwd(), 'data', 'backups', 'msajce_entities_AI_VERIFIED.json');
    
    if (!fs.existsSync(sourcePath)) {
        console.error('❌ Source file not found!');
        process.exit(1);
    }

    const allEntities = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
    console.log(`📋 Total Entities to Audit: ${allEntities.length}`);

    const batchSize = 40;
    const cleanedEntities = [];

    for (let i = 0; i < allEntities.length; i += batchSize) {
        const batch = allEntities.slice(i, i + batchSize);
        console.log(`⏳ Auditing Batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(allEntities.length / batchSize)}...`);

        let success = false;
        for (let attempt = 0; attempt < keys.length; attempt++) {
            try {
                const openai = getClient(attempt);
                const { text } = await generateText({
                    model: openai.chat('gpt-4o-mini'),
                    system: `Identify REAL HUMAN personnel. Delete junk scraper fragments, dept labels, and generic text. Respond with ONLY indices to KEEP. Example: [0, 2, 5]`,
                    prompt: JSON.stringify(batch.map((b: any) => ({ name: b.name, role: b.role, dept: b.department })))
                });

                const keepIndices = JSON.parse(text.match(/\[.*\]/s)?.[0] || '[]');
                keepIndices.forEach(idx => {
                    if (batch[idx]) cleanedEntities.push(batch[idx]);
                });
                success = true;
                break; // Break on success
            } catch (error) {
                console.warn(`⚠️ Key ${attempt+1} limit hit, rotating...`);
                continue;
            }
        }

        if (!success) {
            console.warn(`🛑 All keys limited for batch at index ${i}. Using pattern-matching safety net.`);
            batch.forEach(b => {
                if (b.name.includes(' ') && !/\d/.test(b.name) && b.name.length > 5) cleanedEntities.push(b);
            });
        }
    }

    fs.writeFileSync(outputPath, JSON.stringify(cleanedEntities, null, 2));
    console.log(`✨ Neuro-Sanitization Complete!`);
    console.log(`✅ Final Count: ${cleanedEntities.length} real persons.`);
    console.log(`📍 Saved to: ${outputPath}`);
}

neuralCleanup();
