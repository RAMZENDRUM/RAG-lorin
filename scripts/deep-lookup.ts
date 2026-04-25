import postgres from 'postgres';
import dotenv from 'dotenv';
dotenv.config();

const sql = postgres(process.env.DATABASE_URL!, { ssl: 'require' });

async function deepLookup() {
    console.log('🔍 LOOKUP: Searching for all variations of Weslin...');
    const results = await sql`
        SELECT id, name, role, department, context 
        FROM msajce_entities 
        WHERE name ILIKE '%Weslin%' OR name ILIKE '%Vigneshwaran%'
    `;
    const total = await sql`SELECT count(*) FROM msajce_entities`;
    console.log(`📊 TOTAL ENTITIES: ${total[0].count}`);
    console.log(JSON.stringify(results, null, 2));
    await sql.end();
}

deepLookup().catch(console.error);
