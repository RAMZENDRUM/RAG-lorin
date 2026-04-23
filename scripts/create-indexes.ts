import { QdrantClient } from '@qdrant/js-client-rest';
import dotenv from 'dotenv';
dotenv.config();

const COLLECTION_NAME = 'lorin_msajce_knowledge';
const qdrant = new QdrantClient({
    url: process.env.QDRANT_URL,
    apiKey: process.env.QDRANT_API_KEY
});

async function createIndexes() {
    console.log(`Creating Payload Indexes for ${COLLECTION_NAME}...`);
    try {
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
        console.log('✅ Payload Indexes (category, source_file) created.');
    } catch (e) {
        console.error('Error creating indexes:', e);
    }
}
createIndexes();
