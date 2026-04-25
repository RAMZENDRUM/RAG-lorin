import { 
    classifyIntent, 
    rewriteQuery, 
    hybridRetrieve, 
    rerankResults, 
    agentDecide, 
    buildContext, 
    generateGrounded, 
    postProcess 
} from '../lib/core/orchestrator.ts';
import { createOpenAI } from '@ai-sdk/openai';
import dotenv from 'dotenv';

dotenv.config();

async function test() {
    const VERCEL_KEYS = [
        process.env.VERCEL_AI_KEY,
        process.env.VERCEL_AI_KEY_2,
        process.env.VERCEL_AI_KEY_3,
        process.env.VERCEL_AI_KEY_4
    ].filter(Boolean) as string[];
    
    const activeVercelKey = VERCEL_KEYS[0];
    const openai = createOpenAI({
        apiKey: activeVercelKey,
        baseURL: 'https://ai-gateway.vercel.sh/v1'
    });

    const rawText = 'who is usha';
    console.log('--- Testing Query:', rawText);

    const intent = classifyIntent(rawText);
    console.log('Intent:', intent);

    const profile = { interest: null };
    const rewrittenQuery = rewriteQuery(rawText, intent, profile as any, []);
    console.log('Rewritten Query:', rewrittenQuery);

    const chunks = await hybridRetrieve(rewrittenQuery, rawText, openai, null, 35);
    console.log('Total Chunks Retrieved:', chunks.length);

    const context = await rerankResults(rewrittenQuery, chunks, openai);
    console.log('Context Snippet:', context.slice(0, 200));

    const agentFlags = agentDecide(intent, rawText, context, Date.now(), 'https://forms.gle/test');
    const finalContext = buildContext(context, [], profile as any);
    
    const answer = await generateGrounded(finalContext, rawText, agentFlags, 'https://forms.gle/test', openai);
    console.log('\n--- ANSWER ---\n');
    console.log(answer);
    
    const finalOutput = postProcess(answer, agentFlags, 'https://forms.gle/test', chunks, rawText);
    console.log('\n--- FINAL OUTPUT ---\n');
    console.log(finalOutput);
}

test().catch(console.error);
