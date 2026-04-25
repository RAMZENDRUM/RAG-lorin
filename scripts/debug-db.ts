import postgres from 'postgres';
import dotenv from 'dotenv';
dotenv.config();

const sql = postgres(process.env.DATABASE_URL!, { ssl: 'require' });

async function check() {
    const tables = await sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`;
    console.log('--- TABLES ---');
    console.log(tables.map(t => t.table_name).join(', '));
    
    const count = await sql`SELECT count(*) FROM msajce_entities`;
    console.log(`--- COUNT for msajce_entities: ${count[0].count} ---`);

    const samples = await sql`SELECT name FROM msajce_entities LIMIT 10`;
    console.log('--- FIRST 10 ENTITIES ---');
    console.log(samples.map(s => s.name).join(', '));

    await sql.end();
}

check();
