// @ts-ignore
import { orchestrate } from '../lib/core/orchestrator.js';
// @ts-ignore
import { default as postgres } from 'postgres';
// @ts-ignore
import * as dotenv from 'dotenv';

dotenv.config();

const sql = postgres(process.env.DATABASE_URL!, { ssl: 'require' });

const testQuestions = [
    // Persona & Identity Probes
    { q: "Who is the Principal of MSAJCE?", type: "Persona-Formatting" },
    { q: "tell me about his research and awards", type: "Bulleted-Context" },
    { q: "Who is the developer of this bot?", type: "Developer-Identity" },
    { q: "how can I contact Ramanathan S?", type: "Contact-Anchor" },
    
    // Faculty & Staff (Supabase Entities)
    { q: "Who is Dr. Weslin D?", type: "Entity-Formatting" },
    { q: "Tell me about Ms. S. Usha from CSE.", type: "Depth-Check" },
    { q: "Which professor handles CSI leadership?", type: "Role-Linkage" },
    
    // Admissions & Value (Strategy)
    { q: "What are the UG courses available for this year?", type: "Admission-Data" },
    { q: "Is MSAJCE better than VIT or SRM?", type: "Defense-Mode" },
    { q: "how many seats in AI & Data Science?", type: "Precision-Data" },
    
    // Logistics & Safety (Parent Focus)
    { q: "Tell me about the college bus routes.", type: "Transport-Matrix" },
    { q: "Where is the girls hostel located?", type: "Hostel-Precision" },
    { q: "Is the campus safe from ragging?", type: "Parent-Safety" },
    
    // Skill & Innovation
    { q: "Does the college have a Cisco Academy?", type: "Tech-Center" },
    { q: "Tell me about the 3D Printing lab.", type: "Facility-Detail" },
    { q: "Is there an entrepreneurship cell?", type: "Innovation-Check" },
    
    // Interaction & Variety (Opener Check)
    { q: "hello", type: "Opener-Check" },
    { q: "what's the fee structure?", type: "Fee-Intent" },
    { q: "can you list all clubs?", type: "Clubs-Societies" },
    { q: "thanks for the help", type: "Sentiment-Check" }
];

async function runAudit() {
    console.log('🚀 STARTING 20-POINT LORIN PERSONA & RESPONSE AUDIT...\n');
    const dummyId = "AUDIT_PROBE_" + Date.now();

    for (let i = 0; i < testQuestions.length; i++) {
        const item = testQuestions[i];
        console.log(`[TEST ${i + 1}] (${item.type}) QUESTION: ${item.q}`);
        
        try {
            const { answer, metadata } = await orchestrate(
                dummyId,
                item.q,
                [], // Fresh history for each probe
                { 
                    user_id: dummyId, 
                    name: 'AuditProbe', 
                    interest: 'General', 
                    stage: 'prospect', 
                    last_seen: new Date(), 
                    created_at: new Date(), 
                    tags: ['audit_v10'] 
                },
                sql
            );

            console.log(`🤖 OPENER: ${answer.split(/[.!?]/)[0]}...`);
            console.log(`✍️ RESPONSE:\n${answer}`);
            console.log(`📄 SOURCE: ${metadata.retrieval_source} | LATENCY: ${metadata.latency_ms}ms`);
            console.log('--------------------------------------------------\n');
            
            // Artificial delay to prevent rate limits
            await new Promise(r => setTimeout(r, 1000));
        } catch (e: any) {
            console.error(`❌ TEST ${i+1} FAILED:`, e.message);
        }
    }
    
    console.log('🌟 20-POINT AUDIT COMPLETE.');
    await sql.end();
}

runAudit();
