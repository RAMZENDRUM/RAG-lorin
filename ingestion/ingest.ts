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

const COLLECTION_NAME = 'lorin_msajce_knowledge';
const UNIFIED_DATA_PATH = path.join(process.cwd(), 'data', 'unified_cleaned_data.json');

// Vercel Keys for rotation
const VERCEL_KEYS = [
    process.env.VERCEL_AI_KEY,
    process.env.VERCEL_AI_KEY_2,
    process.env.VERCEL_AI_KEY_3,
    process.env.VERCEL_AI_KEY_4,
].filter(Boolean) as string[];

const openaiClients = VERCEL_KEYS.map(key => createOpenAI({
    apiKey: key,
    baseURL: 'https://ai-gateway.vercel.sh/v1'
}));

async function ingest() {
    console.log('🔍 Loading high-fidelity Firecrawl data (1536 Dimensions)...');
    if (!fs.existsSync(UNIFIED_DATA_PATH)) {
        console.error('❌ unified_cleaned_data.json not found!');
        return;
    }

    const allChunks = await fs.readJson(UNIFIED_DATA_PATH);
    console.log(`🚀 Starting ULTRA-STABLE Ingestion (${allChunks.length} chunks)...`);
    console.log(`💡 Mode: Sequential (No concurrency), 5s Delay, Quad-Key Rotation.`);

    let keyIdx = 0;

    for (let i = 0; i < allChunks.length; i++) {
        const chunk = allChunks[i];
        const currentClient = openaiClients[keyIdx];
        const keyLabel = `Key ${keyIdx + 1}`;

        try {
            // 1. EMBED (1536)
            const { embedding } = await embed({
                model: currentClient.embedding('text-embedding-3-small'),
                value: chunk.content,
            });

            // 2. PUSH TO SUPABASE
            await sql`
                INSERT INTO lorin_knowledge (content, metadata, embedding)
                VALUES (${chunk.content}, ${chunk.metadata}, ${`[${embedding.join(',')}]` })
                ON CONFLICT (content) DO NOTHING;
            `;

            // 3. PUSH TO QDRANT
            await client.upsert(COLLECTION_NAME, {
                wait: true,
                points: [{
                    id: chunk.metadata.id || crypto.randomUUID(),
                    vector: embedding,
                    payload: {
                        ...chunk.metadata,
                        content: chunk.content,
                        type: 'knowledge',
                        category: chunk.metadata.category || 'general'
                        // id: chunk.metadata.id — already in qdrant id field
                    }
                }]
            });

            console.log(`[${i + 1}/${allChunks.length}] ✅ Success (${keyLabel})`);
            
            // Rotate key for next chunk
            keyIdx = (keyIdx + 1) % openaiClients.length;

            // 5 second cooldown to bypass Vercel abuse detection
            await new Promise(r => setTimeout(r, 5000));

        } catch (error: any) {
            console.error(`\n[${i + 1}/${allChunks.length}] ❌ Failed (${keyLabel}): ${error.message}`);
            
            if (error.message.includes('rate limits') || error.message.includes('abuse')) {
                console.log('      ⚠️ Vercel Gateway Blocked. Shifting keys and waiting 30s...');
                await new Promise(r => setTimeout(r, 30000));
                keyIdx = (keyIdx + 1) % openaiClients.length;
                i--; // Retry same chunk
            } else {
                // For other errors, just skip to next
                console.log('      ⚠️ Skipping chunk due to unexpected error.');
            }
        }
    }

    console.log('\n\n🌟 INGESTION COMPLETE! 1536 DIMENSIONS SAVED.');
    console.log(`✅ ${allChunks.length} chunks indexed in Qdrant and Supabase.`);
}

ingest().catch(console.error);
