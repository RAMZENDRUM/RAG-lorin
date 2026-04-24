import { hybridRetrieve, rerankResults } from '../lib/orchestrator.js';
import postgres from 'postgres';
import { createOpenAI } from '@ai-sdk/openai';
import dotenv from 'dotenv';
dotenv.config();

const db = postgres(process.env.DATABASE_URL!);
const key = process.env.VERCEL_AI_KEY || process.env.OPENAI_API_KEY;
const openai = createOpenAI({
    apiKey: key,
    baseURL: key?.startsWith('vck_') ? 'https://ai-gateway.vercel.sh/v1' : undefined
});

async function run() {
    const raw = "tell me more details abt him";
    const intent = "faculty"; // In real run it maps this
    const query = "Dr. K. S. Srinivasan MSAJCE details background role contact";

    const chunks = await hybridRetrieve(query, raw, openai, db);
    console.log("Found chunks from Qdrant+Postgres:", chunks.length);

    console.log("Reranking top 5...");
    const top5 = await rerankResults(query, chunks, openai);
    console.log("--- RERANKED RESULTS ---");
    console.log(top5);

    process.exit(0);
}

run();
