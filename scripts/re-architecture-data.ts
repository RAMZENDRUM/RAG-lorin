import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';

dotenv.config();

// AI Key Rotation
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

const DEPARTMENTS = ['CSE', 'IT', 'ECE', 'EEE', 'MECH', 'CIVIL', 'CSBS', 'AIML', 'VLSI', 'SH'];

async function reArchitecturePool() {
    console.log('🏗️ Starting Dataset Re-Architecture (Level 9 - Structural Integrity)...');
    
    const sourcePath = path.join(process.cwd(), 'data', 'backups', 'msajce_entities_full_export.json');
    const outputPath = path.join(process.cwd(), 'data', 'backups', 'msajce_entities_V9_SEMANTIC.json');
    
    const allEntities = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
    console.log(`📋 Re-Architecting ${allEntities.length} records...`);

    const batchSize = 30;
    const finalEntities = [];

    for (let i = 0; i < allEntities.length; i += batchSize) {
        const batch = allEntities.slice(i, i + batchSize);
        console.log(`⏳ Structural Audit Batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(allEntities.length / batchSize)}...`);

        let success = false;
        for (let attempt = 0; attempt < keys.length; attempt++) {
            try {
                const openai = getClient(attempt);
                const { text } = await generateText({
                    model: openai.chat('gpt-4o-mini'),
                    system: `
                    You are a data architect. Re-structure the following institutional records.
                    
                    STRUCTURE RULES:
                    - type: FACULTY (Dr/Prof/Principal), STUDENT (Batch like 2022-2026), ALUMNI (Company roles/Past grads)
                    - department: MUST be one of [${DEPARTMENTS.join(', ')}] or NULL. (Remove ALUMNI/PLACEMENT from here)
                    - batch: Extract year ranges (e.g., 2023-2027)
                    - designation: Clean position (Assistant Professor, Manager, Student)
                    - degree: BE, BTech, ME, MBA, Ph.D.
                    - organization: Default to "MSAJCE" unless clearly another company.
                    - search_text: A string like "Dr Name Designation Dept MSAJCE type" for RAG.
                    
                    Respond ONLY with a JSON array of records.
                    `,
                    prompt: JSON.stringify(batch.map((b: any) => ({ name: b.name, raw_role: b.role, raw_dept: b.department })))
                });

                const reArchitected = JSON.parse(text.match(/\[.*\]/s)?.[0] || '[]');
                finalEntities.push(...reArchitected);
                success = true;
                break;
            } catch (e) {
                console.warn(`⚠️ Rotating key for architectural pass...`);
            }
        }
    }

    fs.writeFileSync(outputPath, JSON.stringify(finalEntities, null, 2));
    console.log(`✨ Re-Architecture Complete!`);
    console.log(`✅ ${finalEntities.length} records structural integrity restored.`);
    console.log(`📍 Saved to: ${outputPath}`);
}

reArchitecturePool();
