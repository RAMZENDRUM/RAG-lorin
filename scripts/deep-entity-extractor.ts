import { generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import postgres from 'postgres';

dotenv.config();

const rawDir = 'data/raw_detailed';
const sql = postgres(process.env.DATABASE_URL!, { ssl: 'require' });

// ENGINE POOL
const VERCEL_KEYS = [
    process.env.VERCEL_AI_KEY,
    process.env.VERCEL_AI_KEY_2,
    process.env.VERCEL_AI_KEY_3,
    process.env.VERCEL_AI_KEY_4,
].filter(Boolean) as string[];

const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;

const engines = [
    ...(OPENROUTER_KEY ? [{ client: createOpenAI({ apiKey: OPENROUTER_KEY, baseURL: 'https://openrouter.ai/api/v1' }), model: 'openai/gpt-4o-mini' }] : []),
    ...VERCEL_KEYS.map(key => ({
        client: createOpenAI({ apiKey: key, baseURL: 'https://ai-gateway.vercel.sh/v1' }),
        model: 'gpt-4o-mini'
    }))
];

const EXTRACTION_PROMPT = `
You are an Expert Data Engineer. 
Extract every single PERSON mentioned in the raw text table or list.
For each person, provide:
1. FullName
2. Role
3. Department
4. Batch
5. Bio (Context)

Format as JSON array of objects.
Only return the JSON.
`;

async function deepExtractParallel() {
    console.log('🚀 INITIALIZING PARALLEL ENTITY EXTRACTOR...');
    
    await sql`DELETE FROM msajce_entities`;
    console.log('🧹 Wiped msajce_entities.');

    const files = fs.readdirSync(rawDir).filter(f => f.endsWith('.detailed.txt'));

    let engineIdx = 0;

    for (const file of files) {
        const content = fs.readFileSync(path.join(rawDir, file), 'utf-8');
        if (content.length < 50) continue;

        console.log(`🧠 [${file}] Analyzing with ${engines[engineIdx % engines.length].model}...`);
        
        const engine = engines[engineIdx % engines.length];
        
        try {
            const { text } = await generateText({
                model: engine.client(engine.model),
                system: EXTRACTION_PROMPT,
                prompt: content
            });

            const entities = JSON.parse(text.replace(/```json|```/g, '').trim());
            
            for (const entity of entities) {
                if (!entity.FullName) continue;
                await sql`
                    INSERT INTO msajce_entities (name, role, department, batch, context, source_url)
                    VALUES (
                        ${entity.FullName}, 
                        ${entity.Role || null}, 
                        ${entity.Department || null}, 
                        ${entity.Batch || null}, 
                        ${entity.Bio || entity.Context || null}, 
                        ${file}
                    )
                `.catch(() => {});
                console.log(`✅ [${file}] Saved: ${entity.FullName}`);
            }
            engineIdx++; // Rotate on success
        } catch (err: any) {
            console.error(`❌ [${file}] Engine Error: ${err.message}. Trying next engine...`);
            engineIdx++;
        }
    }

    console.log('🌟 PARALLEL ENTITY EXTRACTION COMPLETE.');
    await sql.end();
}

deepExtractParallel().catch(console.error);
