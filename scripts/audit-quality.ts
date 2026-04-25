import postgres from 'postgres';
import dotenv from 'dotenv';
dotenv.config();

const sql = postgres(process.env.DATABASE_URL!, { ssl: 'require' });

async function auditQuality() {
    const dist = await sql`SELECT department, count(*) as total FROM msajce_entities GROUP BY department ORDER BY total DESC`;
    console.log('--- ENTITY DISTRIBUTION ---');
    dist.forEach(d => console.log(`${d.department}: ${d.total}`));

    const samples = await sql`SELECT name, role FROM msajce_entities WHERE department != 'Transport' LIMIT 20`;
    console.log('\n--- RANDOM QUALITY SAMPLE ---');
    samples.forEach(s => console.log(`[${s.name}] -> [${s.role}]`));
    
    await sql.end();
}

auditQuality();
