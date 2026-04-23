import { QdrantClient } from '@qdrant/js-client-rest';
import { embed } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import dotenv from 'dotenv';
dotenv.config();

const VERCEL_KEYS = [
    process.env.VERCEL_AI_KEY,
].filter(Boolean) as string[];

const openai = createOpenAI({ 
    apiKey: VERCEL_KEYS[0],
    baseURL: 'https://ai-gateway.vercel.sh/v1'
});

const qdrant = new QdrantClient({
    url: process.env.QDRANT_URL,
    apiKey: process.env.QDRANT_API_KEY
});

async function rawTest(query: string) {
    console.log(`\n\nTesting query: ${query}`);
    const { embedding } = await embed({
        model: openai.embedding('text-embedding-3-small'),
        value: query
    });

    const vectorResults = await qdrant.search('lorin_msajce_knowledge', {
        vector: embedding,
        limit: 30,
        with_payload: true
    });
    
    if (!vectorResults.length) {
        console.log("NO RESULTS RETURNED");
        return;
    }

    const cleanQuery = query.toLowerCase().replace(/[^\w\s]/g, '');
    const keywords = cleanQuery.split(/\s+/).filter(w => w.length > 3);
    
    let topMatched = null;
    let currentHigh = 0;
    
    vectorResults.forEach(res => {
        const content = (res.payload?.content as string || '').toLowerCase();
        let keywordMatches = 0;
        keywords.forEach(word => {
            if (content.includes(word)) keywordMatches++;
        });
        const keywordScore = keywords.length > 0 ? keywordMatches / keywords.length : 0;
        const hybridScore = (0.85 * res.score) + (0.15 * keywordScore);
        
        if (hybridScore > currentHigh) {
            currentHigh = hybridScore;
            topMatched = {
                score: res.score.toFixed(4),
                keywordScore: keywordScore.toFixed(4),
                hybridScore: hybridScore.toFixed(4),
                preview: content.substring(0, 100).replace(/\n/g, ' ')
            };
        }
    });
    
    console.log(`Top result found in 30:`, topMatched);
}

async function main() {
    await rawTest('hostel facilities??');
}

main();
