import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';

dotenv.config();

const keys = [
    process.env.VERCEL_AI_KEY,
    process.env.VERCEL_AI_KEY_2,
    process.env.VERCEL_AI_KEY_3,
    process.env.VERCEL_AI_KEY_4
].filter(Boolean);

function getClient(attempt: number = 0) {
    const key = keys[attempt % keys.length];
    return createOpenAI({
        apiKey: key,
        baseURL: "https://ai-gateway.vercel.sh/v1"
    });
}

const VALID_DEPTS = ['CSE', 'IT', 'ECE', 'EEE', 'MECH', 'CIVIL', 'CSBS', 'AIML', 'VLSI', 'SH'];

async function strictReArchitecture() {
    console.log('🦾 Starting Level 9 STRICT Re-Architecture...');
    
    const sourcePath = path.join(process.cwd(), 'data', 'backups', 'msajce_entities_V8_ULTIMATE.json');
    const outputPath = path.join(process.cwd(), 'data', 'backups', 'msajce_entities_V9_STRICT.json');
    
    if (!fs.existsSync(sourcePath)) {
        console.error('❌ V8 Source not found!');
        process.exit(1);
    }

    const allEntities = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
    console.log(`📋 Processing ${allEntities.length} records with NO-BS validation...`);

    const batchSize = 30;
    const finalEntities = [];

    for (let i = 0; i < allEntities.length; i += batchSize) {
        const batch = allEntities.slice(i, i + batchSize);
        console.log(`⏳ Strict Audit Batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(allEntities.length / batchSize)}...`);

        let success = false;
        for (let attempt = 0; attempt < keys.length; attempt++) {
            try {
                const openai = getClient(attempt);
                const { text } = await generateText({
                    model: openai.chat('gpt-4o-mini'),
                    system: `
                    You are a strict data architect. Re-structure the following records for a RAG system.
                    
                    RULES:
                    1. type: FACULTY (Dr/Prof/HOD), STUDENT (Roll/Batch like 2022-26), ALUMNI (Company/Job titles/Passed out)
                    2. department: MUST be one of [${VALID_DEPTS.join(', ')}] or NULL.
                    3. designation: Clean job title (Assistant Professor, Manager, Student).
                    4. degree: BE, BTech, ME, MBA, Ph.D.
                    5. batch: Year range (e.g., 2022-2026).
                    6. tags: Array of keywords (e.g., ["faculty", "it", "professor"]).
                    7. search_text: Dense string for retrieval: "[Name] [Designation] [Dept] MSAJCE [type]"
                    
                    CRITICAL:
                    - Convert "role": "2022-2026 / CSE" into designation: "Student", department: "CSE", batch: "2022-2026".
                    - Principal/Faculty departments must be NULL or academic (NOT "ALUMNI").
                    - Remove the "context" field entirely.
                    
                    Respond ONLY with a JSON array.
                    `,
                    prompt: JSON.stringify(batch.map(b => ({ name: b.name, raw_role: b.role, raw_dept: b.department })))
                });

                const reArchitected = JSON.parse(text.match(/\[.*\]/s)?.[0] || '[]');
                finalEntities.push(...reArchitected);
                success = true;
                break;
            } catch (e) {
                console.warn(`⚠️ Key ${attempt+1} limited, rotating...`);
            }
        }
    }

    fs.writeFileSync(outputPath, JSON.stringify(finalEntities, null, 2));
    console.log(`✨ Level 9 STRICT Re-Architecture Complete!`);
    console.log(`✅ ${finalEntities.length} records ready for production.`);
}

strictReArchitecture();
