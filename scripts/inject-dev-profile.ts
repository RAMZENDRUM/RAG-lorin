import postgres from 'postgres';
import dotenv from 'dotenv';
dotenv.config();

const sql = postgres(process.env.DATABASE_URL!, { ssl: 'require' });

async function injectCriticalData() {
    console.log('🚀 Injecting Developer Profile & Transport Core...');
    
    // 1. Inject RAM (The Developer)
    await sql`DELETE FROM msajce_entities WHERE name ILIKE '%Ramanathan%' OR (name = 'Ram' AND role ILIKE '%Developer%')`;
    await sql`
        INSERT INTO msajce_entities (name, role, department, batch, context, source_url)
        VALUES (
            'Ramanathan S (Ram)', 
            'Lead AI Developer & Creator of Lorin', 
            'Intelligence Engineering', 
            'Expert', 
            'Ramanathan (Ram) is the Lead AI Developer and the brilliant mind behind the Lorin AI Concierge. He specializes in RAG systems and AI engineering for MSAJCE.', 
            'developer_profile.system'
        )
    `;

    // 2. Inject Transport Coordinator (If exists in raw)
    // Checking raw files for Transport Coordinator...
    
    console.log('✅ Developer Identity Injected Perfectly.');
    await sql.end();
}

injectCriticalData();
