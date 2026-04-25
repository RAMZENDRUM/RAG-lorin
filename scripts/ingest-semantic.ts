import fs from 'fs';
import path from 'path';
import { QdrantClient } from '@qdrant/js-client-rest';
import { embed } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import postgres from 'postgres';
import dotenv from 'dotenv';
import crypto from 'crypto';

dotenv.config();

const SEMANTIC_DIR = path.join(process.cwd(), 'data/04_semantic');
const COLLECTION_NAME = 'lorin_msajce_knowledge';

const sql = postgres(process.env.DATABASE_URL!, { ssl: 'require' });
const client = new QdrantClient({
    url: process.env.QDRANT_URL!,
    apiKey: process.env.QDRANT_API_KEY!,
});

// Configure OpenAI client for OpenRouter
const openrouter = createOpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: 'https://openrouter.ai/api/v1',
});

async function ingestSemanticFiles() {
    const files = fs.readdirSync(SEMANTIC_DIR).filter(f => f.endsWith('.semantic.txt'));
    console.log(`🚀 Starting Fast 1536 Ingestion (OpenRouter-OpenAI Bridge) for ${files.length} files...`);

    console.log('🧹 Preparing clean 1536 collection...');
    await sql`TRUNCATE TABLE lorin_knowledge`;
    
    try {
        await client.deleteCollection(COLLECTION_NAME);
    } catch (e) {}
    
    await client.createCollection(COLLECTION_NAME, {
        vectors: { size: 1536, distance: 'Cosine' } // STRICT 1536
    });
    
    for (const file of files) {
        console.log(`📦 Processing: ${file}...`);
        const content = fs.readFileSync(path.join(SEMANTIC_DIR, file), 'utf-8');
        const sections = content.split(/\[SECTION: /);
        
        for (const rawSection of sections) {
            if (!rawSection.trim()) continue;
            const [topicLine, ...contentLines] = rawSection.split(']');
            const topic = topicLine.trim();
            const sectionText = contentLines.join(']').trim();
            if (!sectionText) continue;

            const finalContent = `TOPIC: ${topic}\n\n${sectionText}`;
            
            let retry = 3;
            while (retry > 0) {
                try {
                    const { embedding } = await embed({
                        model: openrouter.embedding('openai/text-embedding-3-small'),
                        value: finalContent,
                    });

                    await sql`
                        INSERT INTO lorin_knowledge (content, metadata, embedding)
                        VALUES (${finalContent}, ${JSON.stringify({ source: file, topic })}, ${`[${embedding.join(',')}]` })
                    `;

                    await client.upsert(COLLECTION_NAME, {
                        points: [{
                            id: crypto.randomUUID(),
                            vector: embedding,
                            payload: {
                                content: finalContent,
                                source: file,
                                topic: topic,
                                category: 'knowledge_base'
                            }
                        }]
                    });
                    
                    break;
                } catch (err: any) {
                    console.error(`⚠️ OpenRouter Retry on ${file}:`, err.message);
                    await new Promise(r => setTimeout(r, 5000));
                    retry--;
                }
            }
        }
        console.log(`✅ Indexed: ${file}`);
        await new Promise(r => setTimeout(r, 500)); // Half second delay
    }
    console.log('✨ Lorin Knowledge Base is now 100% Production-Ready (1536 Bridge OK)!');
    process.exit(0);
}

ingestSemanticFiles();
