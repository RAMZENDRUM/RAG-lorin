import { QdrantClient } from '@qdrant/js-client-rest';
import { createOpenAI } from '@ai-sdk/openai';
import { embed } from 'ai';
import postgres from 'postgres';
import dotenv from 'dotenv';
import fs from 'fs-extra';
import path from 'path';
import crypto from 'crypto';

dotenv.config();

const QDRANT_URL = process.env.QDRANT_URL!;
const QDRANT_API_KEY = process.env.QDRANT_API_KEY!;
const DATABASE_URL = process.env.DATABASE_URL!;

const client = new QdrantClient({ url: QDRANT_URL, apiKey: QDRANT_API_KEY });
const sql = postgres(DATABASE_URL, { ssl: 'require' });

// ENGINE POOL
const VERCEL_KEYS = [
    process.env.VERCEL_AI_KEY,
    process.env.VERCEL_AI_KEY_2,
    process.env.VERCEL_AI_KEY_3,
    process.env.VERCEL_AI_KEY_4,
].filter(Boolean) as string[];

const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;

const engines = [
    ...(OPENROUTER_KEY ? [{ name: 'OpenRouter', client: createOpenAI({ apiKey: OPENROUTER_KEY, baseURL: 'https://openrouter.ai/api/v1' }), delay: 100, model: 'openai/text-embedding-3-small' }] : []),
    ...VERCEL_KEYS.map((key, i) => ({
        name: `Vercel-${i + 1}`,
        client: createOpenAI({ apiKey: key, baseURL: 'https://ai-gateway.vercel.sh/v1' }),
        delay: 12500,
        model: 'text-embedding-3-small'
    }))
];

const COLLECTION_NAME = 'lorin_msajce_knowledge';
const RAW_DIR = path.join(process.cwd(), 'data/03_master');

function chunkText(text: string, size: number = 1000): string[] {
    const chunks: string[] = [];
    const lines = text.split('\n');
    let currentChunk = '';
    for (const line of lines) {
        if ((currentChunk + line).length > size && currentChunk) {
            chunks.push(currentChunk.trim());
            currentChunk = '';
        }
        currentChunk += line + '\n';
    }
    if (currentChunk.trim()) chunks.push(currentChunk.trim());
    return chunks;
}

async function ingest() {
    console.log('🚀 Checking for fresh parallel sync (Incremental)...');
    try {
        // Ensure collection exists without deleting it
        const collections = await client.getCollections();
        if (!collections.collections.some(c => c.name === COLLECTION_NAME)) {
            await client.createCollection(COLLECTION_NAME, { vectors: { size: 1536, distance: 'Cosine' } });
            console.log(`✅ Created fresh collection: ${COLLECTION_NAME}`);
        }
    } catch (e: any) { console.warn('⚠️ Collection Check Warning:', e.message); }

    const files = (await fs.readdir(RAW_DIR)).filter(f => f.endsWith('.master.txt'));
    const allData: { content: string, metadata: any }[] = [];
    
    for (const file of files) {
        const content = await fs.readFile(path.join(RAW_DIR, file), 'utf-8');
        const chunks = chunkText(content);
        chunks.forEach((c, idx) => {
            allData.push({
                content: c,
                metadata: {
                    source: file,
                    url: `https://www.msajce-edu.in/${file.replace('.master.txt', '.php')}`,
                    chunk_idx: idx,
                    id: crypto.randomBytes(16).toString('hex')
                }
            });
        });
    }

    console.log(`🚀 MULTI-ENGINE PUSH: ${allData.length} chunks via ${engines.length} Parallel Workers...`);

    let currentIndex = 0;
    const total = allData.length;

    // Worker Function
    async function worker(engine: typeof engines[0]) {
        while (currentIndex < total) {
            const i = currentIndex++; // ATOMIC CLAIM
            if (i >= total) break;

            const item = allData[i];
            try {
                const { embedding } = await embed({
                    model: engine.client.embedding(engine.model),
                    value: item.content,
                });

                await sql`
                    INSERT INTO lorin_knowledge (content, metadata, embedding)
                    VALUES (${item.content}, ${item.metadata}, ${`[${embedding.join(',')}]` });
                `;

                await client.upsert(COLLECTION_NAME, {
                    wait: i === total - 1,
                    points: [{
                        id: item.metadata.id,
                        vector: embedding,
                        payload: { ...item.metadata, content: item.content, type: 'knowledge' }
                    }]
                });

                console.log(`[${i + 1}/${total}] ✅ ${engine.name}: ${item.metadata.source}`);
                await new Promise(r => setTimeout(r, engine.delay));

            } catch (error: any) {
                console.error(`\n❌ ${engine.name} Error at ${i}: ${error.message}`);
                // Put it back in the queue if possible (simplified: just wait and retry)
                currentIndex--; 
                await new Promise(r => setTimeout(r, 10000));
            }
        }
    }

    // Start all workers simultaneously
    await Promise.all(engines.map(e => worker(e)));

    console.log('\n\n🌟 PARALLEL SYNC COMPLETE! TOTAL SPEED ACHIEVED.');
}

ingest().catch(console.error);
