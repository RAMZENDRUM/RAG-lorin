import { google } from '@ai-sdk/google';
import { embed } from 'ai';
import dotenv from 'dotenv';

dotenv.config();

async function test() {
    try {
        const { embedding } = await embed({
            model: google.embedding('text-embedding-004'),
            value: 'Hello world'
        });
        console.log('Gemini Embedding Length:', embedding.length);
        console.log('Gemini Vector (start):', embedding.slice(0, 5));
    } catch (e) {
        console.error('Gemini Failed:', e);
    }
}

test();
