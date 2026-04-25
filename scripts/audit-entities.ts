import postgres from 'postgres';
import dotenv from 'dotenv';
dotenv.config();

const sql = postgres(process.env.DATABASE_URL!, { ssl: 'require' });

async function check() {
    console.log('🔍 Auditing Database for Yogesh...');
    const results = await sql`SELECT * FROM msajce_entities WHERE name ILIKE '%Yogesh%'`;
    console.log(JSON.stringify(results, null, 2));
    await sql.end();
}

check();
