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

function getOpenAI() {
    const key = process.env.VERCEL_AI_KEY || process.env.OPENAI_API_KEY;
    const isVercelGateway = key?.startsWith('vck_');
    return createOpenAI({ 
        apiKey: key,
        baseURL: isVercelGateway ? 'https://ai-gateway.vercel.sh/v1' : undefined
    });
}

async function ingest() {
    console.log('🚀 Starting DUAL Ingestion (Qdrant Main + Supabase Secondary)...');
    
    const dataPath = path.join(process.cwd(), 'data', 'unified_cleaned_data.json');
    const chunks = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
    const openai = getOpenAI();

    for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        console.log(`Processing Chunk ${i+1}/${chunks.length}...`);

        try {
            const { embedding } = await embed({ model: openai.embedding('text-embedding-3-small'), value: chunk.content });

            // 1. PUSH TO QDRANT (Primary)
            await qdrant.upsert(COLLECTION_NAME, {
                points: [{
                    id: i,
                    vector: embedding,
                    payload: { content: chunk.content, ...chunk.metadata }
                }]
            });

            // 2. PUSH TO SUPABASE (Secondary)
            await sql`
                INSERT INTO lorin_knowledge (content, metadata, embedding)
                VALUES (${chunk.content}, ${chunk.metadata}, ${`[${embedding.join(',')}]`})
                ON CONFLICT DO NOTHING;
            `;

        } catch (e: any) {
            console.error(`Failed at chunk ${i}:`, e.message);
        }
    }

    console.log('✅ DUAL INGESTION COMPLETE! Lorin is now synched across Qdrant and Supabase.');
    process.exit(0);
}

ingest();
