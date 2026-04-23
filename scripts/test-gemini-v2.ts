import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { embed } from 'ai';
import dotenv from 'dotenv';

dotenv.config();

const google = createGoogleGenerativeAI({
    apiKey: process.env.GEMINI_API_KEY,
});

async function test() {
    try {
        const { embedding } = await embed({
            model: google.textEmbeddingModel('text-embedding-004'),
            value: 'hello world'
        });
        console.log('Gemini 004 Dims:', embedding.length);
    } catch (e) {
        console.error('Failed:', e);
    }
}

test();
