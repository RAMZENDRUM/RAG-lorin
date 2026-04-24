import { createOpenAI } from '@ai-sdk/openai';
import { embed, generateText } from 'ai';
import dotenv from 'dotenv';
dotenv.config();

const VERCEL_KEYS = [
    process.env.VERCEL_AI_KEY,
    process.env.VERCEL_AI_KEY_2,
    process.env.VERCEL_AI_KEY_3,
    process.env.VERCEL_AI_KEY_4
].filter(Boolean) as string[];

async function testKeys() {
    console.log(`🔍 Testing ${VERCEL_KEYS.length} Vercel Gateway Keys...`);
    
    for (let i = 0; i < VERCEL_KEYS.length; i++) {
        const key = VERCEL_KEYS[i];
        console.log(`\nTesting Key ${i + 1}...`);
        const openai = createOpenAI({
            apiKey: key,
            baseURL: 'https://ai-gateway.vercel.sh/v1'
        });

        try {
            const { text } = await generateText({
                model: openai('gpt-4o-mini'),
                prompt: 'Reply quickly with exactly: "Key is Active".'
            });
            console.log(`✅ Key ${i + 1} SUCCESS: ${text}`);
            
            // Also test embedding
            try {
                const { embedding } = await embed({
                    model: openai.embedding('text-embedding-3-small'),
                    value: 'Test',
                });
                console.log(`✅ Key ${i + 1} EMBEDDING SUCCESS.`);
                return; // Stop on full success
            } catch (err: any) {
                console.log(`❌ Key ${i + 1} EMBEDDING FAILED: ${err.message}`);
            }

        } catch (e: any) {
            console.log(`❌ Key ${i + 1} GENERATION FAILED: ${e.message}`);
        }
    }
    
    console.log('\n🚨 ALL VERCEL KEYS ARE CURRENTLY BLOCKED DUE TO RATE LIMITS.');
}

testKeys();
