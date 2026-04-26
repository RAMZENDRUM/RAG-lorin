// @ts-ignore
import { orchestrate } from '../lib/core/orchestrator.js';
// @ts-ignore
import { default as postgres } from 'postgres';
// @ts-ignore
import * as dotenv from 'dotenv';

dotenv.config();

const sql = postgres(process.env.DATABASE_URL!, { ssl: 'require' });

const testQuestions = [
    { q: "Who is the Principal of MSAJCE?", state: true },
    { q: "more about him", state: true }, // Continuation Test
    { q: "What is the name of the CSI Student President?", state: true },
    { q: "who is the secretary?", state: true }, // Context Test
    { q: "List all the UG engineering programs offered.", state: false },
    { q: "Can parents use the college bus to visit campus?", state: false },
    { q: "Who is the Administrative Officer of the college?", state: false },
    { q: "Tell me about the CSI Student Counselor.", state: false },
    { q: "Which companies recruit from MSAJCE?", state: false },
    { q: "Is there a hostel facility?", state: false },
    { q: "Who is the developer of this Lorin bot?", state: false }
];

async function runAudit() {
    console.log('🚀 STARTING LORIN STATE-AWARE INTELLIGENCE AUDIT...\n');
    const dummyId = "AUDIT_USER_" + Date.now();

    for (let i = 0; i < testQuestions.length; i++) {
        const item = testQuestions[i];
        console.log(`[TEST ${i + 1}] QUESTION: ${item.q}`);
        
        try {
            const { answer, metadata } = await orchestrate(
                dummyId,
                item.q,
                [], // Empty history for individual probes
                { 
                    user_id: dummyId, 
                    name: 'AuditBot', 
                    interest: 'General', 
                    stage: 'prospect', 
                    last_seen: new Date(), 
                    created_at: new Date(), 
                    tags: ['audit'] 
                },
                sql
            );

            console.log(`🤖 TONE: ${metadata.intent}`);
            console.log(`📄 SOURCE: ${metadata.retrieval_source}`);
            console.log(`✍️ RESPONSE: ${answer.substring(0, 500)}...`);
            console.log('--------------------------------------------------\n');
            
            // Artificial delay to prevent rate limits
            await new Promise(r => setTimeout(r, 1000));
        } catch (e: any) {
            console.error(`❌ TEST ${i+1} FAILED:`, e.message);
        }
    }
    
    console.log('🌟 AUDIT COMPLETE.');
    await sql.end();
}

runAudit();
