import { 
    classifyIntent, 
    rewriteQuery, 
    hybridRetrieve, 
    rerankResults, 
    agentDecide, 
    buildContext, 
    generateGrounded, 
    postProcess 
} from '../lib/core/orchestrator.js';
import { createOpenAI } from '@ai-sdk/openai';
import postgres from 'postgres';
import dotenv from 'dotenv';

dotenv.config();

const sql = postgres(process.env.DATABASE_URL!, { ssl: 'require' });
const openai = createOpenAI({ 
    apiKey: process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY, 
    baseURL: 'https://openrouter.ai/api/v1' 
});
const GOOGLE_FORM_URL = "https://forms.gle/mock-enquiry";

const testQuestions = [
    "Who is the Principal of MSAJCE?",
    "What is the name of the CSI Student President?",
    "List all the UG engineering programs offered.",
    "Can parents use the college bus to visit campus?",
    "Who is the Administrative Officer of the college?",
    "Tell me about the CSI Student Counselor.",
    "Which companies recruit from MSAJCE?",
    "Is there a hostel facility?",
    "Who is the developer of this Lorin bot?",
    "Tell me about the Fine Arts club leadership."
];

async function runAudit() {
    console.log('🚀 STARTING 10-POINT LORIN INTELLIGENCE AUDIT...\n');

    for (let i = 0; i < testQuestions.length; i++) {
        const q = testQuestions[i];
        console.log(`[TEST ${i + 1}] QUESTION: ${q}`);
        
        try {
            const intent = classifyIntent(q);
            const rewritten = rewriteQuery(q, intent, { interest: 'General' } as any);
            const chunks = await hybridRetrieve(rewritten, q, openai, sql);
            const context = await rerankResults(rewritten, chunks, openai);
            const flags = agentDecide(intent, q, context, Date.now(), GOOGLE_FORM_URL);
            const built = buildContext(context, [], { interest: 'General' } as any);
            const answer = await generateGrounded(built, q, flags, GOOGLE_FORM_URL, openai);
            const final = postProcess(answer, flags, GOOGLE_FORM_URL, chunks);

            console.log(`🤖 RESPONSE: ${final.substring(0, 300)}...`);
            console.log('--------------------------------------------------\n');
        } catch (e: any) {
            console.error(`❌ TEST ${i+1} FAILED:`, e.message);
        }
    }
    
    console.log('🌟 AUDIT COMPLETE.');
    await sql.end();
}

runAudit();
