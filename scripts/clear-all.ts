import postgres from 'postgres';
import { QdrantClient } from '@qdrant/js-client-rest';
import dotenv from 'dotenv';
dotenv.config();

const sql = postgres(process.env.DATABASE_URL!, { ssl: 'require' });
const qdrant = new QdrantClient({ url: process.env.QDRANT_URL, apiKey: process.env.QDRANT_API_KEY });
const COLLECTION_NAME = 'lorin_msajce_knowledge';

async function clearAll() {
    console.log('🚮 Starting Global Data Purge...');
    
    try {
        // 1. Clear Supabase
        await sql`TRUNCATE TABLE lorin_knowledge;`;
        console.log('✅ Supabase: Knowledge table wiped.');

        // 2. Clear Qdrant
        await qdrant.deleteCollection(COLLECTION_NAME);
        await qdrant.createCollection(COLLECTION_NAME, {
            vectors: { size: 1536, distance: 'Cosine' }
        });
        console.log('✅ Qdrant: Collection reset to 1536 dimensions.');

        console.log('🌟 READY FOR HIGH-FIDELITY INGESTION.');
    } catch (e: any) {
        console.error('❌ Error during purge:', e.message);
    }
}

clearAll();
