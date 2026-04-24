import { createOpenAI } from '@ai-sdk/openai';
import { embed } from 'ai';
import dotenv from 'dotenv';
dotenv.config();

const testKey = process.env.OPENAI_API_KEY!;

async function testKeyLogic() {
    console.log('🧪 Testing provided OpenAI Key...');
    const openai = createOpenAI({ apiKey: testKey });
    try {
        const { embedding } = await embed({
            model: openai.embedding('text-embedding-3-small'),
            value: 'Test connection',
        });
        console.log('✅ Key Verified!');
    } catch (e: any) { console.error('❌ Failed:', e.message); }
}
testKeyLogic();
