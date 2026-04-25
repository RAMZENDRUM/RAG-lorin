import { QdrantClient } from '@qdrant/js-client-rest';
import { createOpenAI } from '@ai-sdk/openai';
import { embed } from 'ai';
import dotenv from 'dotenv';

dotenv.config();

const client = new QdrantClient({ 
    url: process.env.QDRANT_URL!, 
    apiKey: process.env.QDRANT_API_KEY! 
});

const openai = createOpenAI({
    apiKey: process.env.VERCEL_AI_KEY,
    baseURL: 'https://ai-gateway.vercel.sh/v1'
});

async function inspect(query: string) {
    const { embedding } = await embed({
        model: openai.embedding('text-embedding-3-small'),
        value: query,
    });

    const results = await client.search('lorin_msajce_knowledge', {
        vector: embedding,
        limit: 5,
        with_payload: true
    });

    console.log(`Top 5 results for: ${query}`);
    results.forEach((r, i) => {
        console.log(`[${i+1}] Score: ${r.score}`);
        console.log(`Content: ${r.payload?.content}`);
        console.log('---');
    });
}

const q = process.argv[2] || 'Abu Jabar Mubarak';
inspect(q).catch(console.error);
