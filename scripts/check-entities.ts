import postgres from 'postgres';
import dotenv from 'dotenv';
dotenv.config();

const sql = postgres(process.env.DATABASE_URL!, { ssl: 'require' });

async function check() {
    const res = await sql`SELECT count(*) FROM msajce_entities`;
    console.log(`📊 TOTAL ENTITIES IN SUPABASE: ${res[0].count}`);
    await sql.end();
}

check();
