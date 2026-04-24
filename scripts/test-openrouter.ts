import { createOpenAI } from '@ai-sdk/openai';
import { embed } from 'ai';
import dotenv from 'dotenv';
dotenv.config();

const orKey = process.env.OPENROUTER_API_KEY!;

async function testOpenRouter() {
    console.log('🧪 Testing OpenRouter Key...');
    const orClient = createOpenAI({ apiKey: orKey, baseURL: 'https://openrouter.ai/api/v1' });
    try {
        const { embedding } = await embed({
            model: orClient.embedding('openai/text-embedding-3-small'),
            value: 'Testing OpenRouter',
        });
        console.log('✅ OpenRouter Verified!');
    } catch (e: any) { console.error('❌ Failed:', e.message); }
}
testOpenRouter();
