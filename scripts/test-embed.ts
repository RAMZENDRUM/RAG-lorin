import { embed } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import dotenv from 'dotenv';
dotenv.config();

const openai = createOpenAI({ 
    apiKey: process.env.VERCEL_AI_KEY,
    baseURL: 'https://ai-gateway.vercel.sh/v1'
});

async function test() {
    try {
        const { embedding } = await embed({
            model: openai.embedding('text-embedding-3-small'),
            value: 'Hello world'
        });
        console.log('Success:', embedding.length);
    } catch (e) {
        console.error('Error:', e);
    }
}
test();
