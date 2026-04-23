import { QdrantClient } from '@qdrant/js-client-rest';
import dotenv from 'dotenv';
dotenv.config();

const COLLECTION_NAME = 'lorin_msajce_knowledge';
const qdrant = new QdrantClient({
    url: process.env.QDRANT_URL,
    apiKey: process.env.QDRANT_API_KEY
});

async function clear() {
    console.log(`Purging ${COLLECTION_NAME}...`);
    try {
        await qdrant.deleteCollection(COLLECTION_NAME);
        await qdrant.createCollection(COLLECTION_NAME, {
            vectors: { size: 1536, distance: 'Cosine' }
        });
        
        // AUTO-CREATE INDEXES to prevent "Bad Request" errors
        await qdrant.createPayloadIndex(COLLECTION_NAME, {
            field_name: 'category',
            field_schema: 'keyword',
            wait: true
        });
        await qdrant.createPayloadIndex(COLLECTION_NAME, {
            field_name: 'source_file',
            field_schema: 'keyword',
            wait: true
        });
        
        console.log('✅ Collection wiped and payload indexes created.');
    } catch (e) {
        console.error('Error clearing collection:', e);
    }
}
clear();
