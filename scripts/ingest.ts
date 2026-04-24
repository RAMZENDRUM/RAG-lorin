import { QdrantClient } from '@qdrant/js-client-rest';
import { embed } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import postgres from 'postgres';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

// --- INFRA ---
const COLLECTION_NAME = 'lorin_msajce_knowledge';
const qdrant = new QdrantClient({
    url: process.env.QDRANT_URL,
    apiKey: process.env.QDRANT_API_KEY
});

const sql = postgres(process.env.DATABASE_URL || '', { ssl: 'require' });

// Create 4 Clients for Batch Rotation
const keys = [
    process.env.VERCEL_AI_KEY,
    process.env.VERCEL_AI_KEY_2,
    process.env.VERCEL_AI_KEY_3,
    process.env.VERCEL_AI_KEY_4
].filter(Boolean) as string[];

const clients = keys.map(key => createOpenAI({
    apiKey: key,
    baseURL: 'https://ai-gateway.vercel.sh/v1'
}));

async function isAlreadyIngested(hash: string) {
    try {
        const result = await sql`
            SELECT 1 FROM lorin_knowledge 
            WHERE metadata->>'id' = ${hash}
            LIMIT 1;
        `;
        return result.length > 0;
    } catch (e) {
        return false;
    }
}

async function processChunk(chunk: any, index: number, clientIndex: number) {
    const client = clients[clientIndex % clients.length];
    
    try {
        const { embedding } = await embed({ 
            model: client.embedding('text-embedding-3-small'), 
            value: chunk.content 
        });

        // 1. PUSH TO QDRANT
        await qdrant.upsert(COLLECTION_NAME, {
            points: [{
                id: index, // Using index as numeric ID for Qdrant
                vector: embedding,
                payload: { content: chunk.content, ...chunk.metadata }
            }]
        });

        // 2. PUSH TO SUPABASE
        await sql`
            INSERT INTO lorin_knowledge (content, metadata, embedding)
            VALUES (${chunk.content}, ${chunk.metadata}, ${`[${embedding.join(',')}]` })
            ON CONFLICT (content) DO NOTHING;
        `;
        
        return true;
    } catch (e: any) {
        console.error(`❌ Error in chunk ${index} (Key ${clientIndex+1}): ${e.message}`);
        return false;
    }
}

async function ingest() {
    const unifiedPath = path.join(process.cwd(), 'data', 'unified_cleaned_data.json');
    const allChunks = JSON.parse(fs.readFileSync(unifiedPath, 'utf-8'));
    
    console.log('🔍 Checking for already ingested content...');
    
    // Fetch all existing hashes to avoid O(N) queries later
    const existingRows = await sql`SELECT metadata->>'id' as id FROM lorin_knowledge`;
    const existingHashes = new Set(existingRows.map(r => r.id));
    
    const chunksToProcess = allChunks.filter((c: any) => !existingHashes.has(c.metadata.id));
    
    if (chunksToProcess.length === 0) {
        console.log('✨ All chunks already ingested. Nothing to do!');
        process.exit(0);
    }

    console.log(`🚀 Starting QUAD-KEY SMART Ingestion (${chunksToProcess.length}/${allChunks.length} chunks remaining)...`);
    
    const BATCH_SIZE = 40; 
    
    for (let i = 0; i < chunksToProcess.length; i += BATCH_SIZE) {
        const batch = chunksToProcess.slice(i, i + BATCH_SIZE);
        console.log(`\n📦 Batch ${Math.floor(i/BATCH_SIZE) + 1}: Processing ${batch.length} chunks...`);

        let successCount = 0;
        
        // Execute sequentially within batch with rotation
        for (let j = 0; j < batch.length; j++) {
            const chunk = batch[j];
            const clientIdx = j % clients.length;
            
            // Log rotation
            process.stdout.write(`[Key ${clientIdx + 1}] `);
            
            const success = await processChunk(chunk, chunk.index, clientIdx);
            if (success) successCount++;
            
            // Minimal gap to prevent IP spikes
            await new Promise(resolve => setTimeout(resolve, 300));
        }

        console.log(`\n✅ Batch Complete: ${successCount}/${batch.length} saved.`);

        if (i + BATCH_SIZE < chunksToProcess.length) {
            console.log(`🕒 Cooldown: Waiting 50 seconds before next batch...`);
            await new Promise(resolve => setTimeout(resolve, 50000));
        }
    }

    console.log('\n🌟 SMART INGESTION COMPLETE!');
    process.exit(0);
}

ingest().catch(console.error);
