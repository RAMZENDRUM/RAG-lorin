import { QdrantClient } from '@qdrant/js-client-rest';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

const url = process.env.QDRANT_URL;
const apiKey = process.env.QDRANT_API_KEY;

if (!url || !apiKey) {
    console.error('QDRANT_URL or QDRANT_API_KEY not found in .env');
    process.exit(1);
}

const client = new QdrantClient({ url, apiKey });

const COLLECTION_NAME = 'lorin_msajce_knowledge';

async function setup() {
    console.log(`Setting up Qdrant collection: ${COLLECTION_NAME}...`);
    
    try {
        const collections = await client.getCollections();
        if (collections.collections.some(c => c.name === COLLECTION_NAME)) {
            console.log(`Collection ${COLLECTION_NAME} already exists. Deleting and recreating...`);
            await client.deleteCollection(COLLECTION_NAME);
        }

        await client.createCollection(COLLECTION_NAME, {
            vectors: {
                size: 1536, // OpenAI text-embedding-3-small
                distance: 'Cosine'
            }
        });

        console.log('Collection created. Creating payload indexes...');

        const indexes = ['type', 'category', 'route_no', 'department'];
        for (const field of indexes) {
            await client.createPayloadIndex(COLLECTION_NAME, {
                field_name: field,
                field_schema: 'keyword'
            });
            console.log(`- Index created for: ${field}`);
        }

        console.log('\n✅ Qdrant setup complete for Lorin!');
    } catch (error) {
        console.error('Failed to setup Qdrant:', error);
    }
}

setup();
