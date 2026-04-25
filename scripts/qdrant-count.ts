import { QdrantClient } from '@qdrant/js-client-rest';
import dotenv from 'dotenv';
dotenv.config();

const client = new QdrantClient({
    url: process.env.QDRANT_URL as string,
    apiKey: process.env.QDRANT_API_KEY as string,
});

async function qdrantCount() {
    try {
        const res = await client.getCollection('lorin_msajce_knowledge');
        console.log(`\n\n📚 TOTAL KNOWLEDGE CHUNKS: ${res.points_count}\n\n`);
    } catch (e) {
        console.error('❌ Qdrant Fetch Failed:', e);
    }
}

qdrantCount();
