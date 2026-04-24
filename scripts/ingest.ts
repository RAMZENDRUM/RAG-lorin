import { QdrantClient } from '@qdrant/js-client-rest';
import { embedMany } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import crypto from 'crypto';

dotenv.config();

const COLLECTION_NAME = 'lorin_msajce_knowledge';

const VERCEL_KEYS = [
    process.env.VERCEL_AI_KEY,
    process.env.VERCEL_AI_KEY_2,
    process.env.VERCEL_AI_KEY_3,
    process.env.VERCEL_AI_KEY_4
].filter(Boolean) as string[];

const qdrant = new QdrantClient({
    url: process.env.QDRANT_URL,
    apiKey: process.env.QDRANT_API_KEY
});

// Create chunks array
function chunkArray<T>(array: T[], size: number): T[][] {
    const chunked_arr = [];
    let index = 0;
    while (index < array.length) {
        chunked_arr.push(array.slice(index, size + index));
        index += size;
    }
    return chunked_arr;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function ingest() {
    console.log('Starting ingestion using OpenAI embeddings (1536 dims) with 4-Key rotation...');
    
    if (VERCEL_KEYS.length === 0) {
        console.error("No VERCEL_AI_KEY provided!");
        return;
    }

    const dataPath = path.join(process.cwd(), 'data', 'unified_cleaned_data.json');
    if (!fs.existsSync(dataPath)) return;
    
    let chunks = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
    console.log(`Processing ${chunks.length} total chunks...`);

    // PARALLEL INGESTION STRATEGY: 4 keys * 10 RPM = 40 RPM Total Throttle
    const batches = chunkArray(chunks, 10);
    console.log(`🚀 Partitioning ${batches.length} batches across ${VERCEL_KEYS.length} parallel streams...`);

    // Split batches into 4 independent streams
    const streamQueues = VERCEL_KEYS.map((_, i) => 
        batches.filter((_, idx) => idx % VERCEL_KEYS.length === i)
    );

    interface Chunk {
    content: string;
    metadata: Record<string, any>;
}

const processStream = async (queue: Chunk[][], key: string, streamId: number) => {
        for (let i = 0; i < queue.length; i++) {
            const batch = queue[i];
            let success = false;
            let retries = 0;

            while (!success && retries < 3) {
                try {
                    const currentOpenAi = createOpenAI({
                        apiKey: key,
                        baseURL: 'https://ai-gateway.vercel.sh/v1'
                    });

                    const texts = batch.map((c: any) => c.content);
                    const { embeddings } = await embedMany({
                        model: currentOpenAi.embedding('text-embedding-3-small'),
                        values: texts
                    });

                    const points = batch.map((chunk: any, index: number) => {
                        const hash = crypto.createHash('md5').update(chunk.content).digest('hex');
                        const uuid = `${hash.substring(0,8)}-${hash.substring(8,12)}-${hash.substring(12,16)}-${hash.substring(16,20)}-${hash.substring(20,32)}`;
                        return {
                            id: uuid,
                            vector: embeddings[index],
                            payload: { content: chunk.content, ...chunk.metadata }
                        };
                    });
                    
                    await qdrant.upsert(COLLECTION_NAME, { wait: true, points: points });
                    console.log(`✅ [Key #${streamId}] Batch ${i+1}/${queue.length}`);
                    success = true;
                    
                    // BURST STRATEGY: 0.5s gap for 5 requests, then 30s rest to keep 10 RPM
                    if ((i + 1) % 5 === 0) {
                        console.log(`⏳ [Key #${streamId}] Resting for 30s to reset RPM...`);
                        await sleep(30000); 
                    } else {
                        await sleep(500); 
                    }
                } catch (err: any) {
                    retries++;
                    console.error(`❌ [Key #${streamId}] Error: ${err.message}. Rotating backoff...`);
                    await sleep(3000 * retries);
                }
            }
        }
    };

    // Launch all 4 key-streams simultaneously
    await Promise.all(streamQueues.map((queue, i) => processStream(queue, VERCEL_KEYS[i], i + 1)));
    console.log(`\n🎉 MULTI-KEY PARALLEL INGESTION SUCCESSFUL!`);
}

ingest();
