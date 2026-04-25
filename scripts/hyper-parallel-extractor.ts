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
    ...(OPENROUTER_KEY ? [{ name: 'OpenRouter', client: createOpenAI({ apiKey: OPENROUTER_KEY, baseURL: 'https://openrouter.ai/api/v1' }), model: 'openai/gpt-4o-mini' }] : []),
    ...VERCEL_KEYS.map((key, i) => ({
        name: `Vercel-${i + 1}`,
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
    console.log('🚀 INITIALIZING HYPER-PARALLEL ENTITY EXTRACTOR...');
    
    // We already wiped in the previous run, let's just append or deduplicate.
    // Actually, for speed, keep it clean.
    await sql`DELETE FROM msajce_entities`;
    console.log('🧹 Wiped msajce_entities.');

    const allFiles = fs.readdirSync(rawDir).filter(f => f.endsWith('.detailed.txt'));
    let fileIndex = 0;

    async function worker(engine: typeof engines[0]) {
        while (fileIndex < allFiles.length) {
            const i = fileIndex++;
            if (i >= allFiles.length) break;

            const file = allFiles[i];
            const content = fs.readFileSync(path.join(rawDir, file), 'utf-8');
            if (content.length < 50) continue;

            console.log(`🧠 [${engine.name}] Processing: ${file}`);
            
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
                }
                console.log(`✅ [${engine.name}] Finished Sample: ${file} (${entities.length} entities)`);
            } catch (err: any) {
                console.error(`❌ [${engine.name}] Error in ${file}: ${err.message}`);
                fileIndex--; // Push back to queue
                await new Promise(r => setTimeout(r, 10000));
            }
        }
    }

    // Launch all workers in parallel
    await Promise.all(engines.map(e => worker(e)));

    console.log('🌟 HYPER-PARALLEL EXTRACTION COMPLETE.');
    await sql.end();
}

deepExtractParallel().catch(console.error);
