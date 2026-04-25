import postgres from 'postgres';
import dotenv from 'dotenv';
dotenv.config();

const sql = postgres(process.env.DATABASE_URL!, { ssl: 'require' });

async function deepLookup() {
    console.log('🔍 LOOKUP: Searching for all variations of Weslin...');
    const results = await sql`
        SELECT name, role, department, type, email, phone 
        FROM msajce_entities 
        WHERE name ILIKE '%Weslin%'
    `;
    console.log('📊 RESULTS FOUND:');
    console.table(results);
    await sql.end();
}

deepLookup().catch(console.error);
