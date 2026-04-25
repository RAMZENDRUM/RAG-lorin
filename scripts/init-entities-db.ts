import postgres from 'postgres';
import dotenv from 'dotenv';
dotenv.config();

const sql = postgres(process.env.DATABASE_URL!, { ssl: 'require' });

async function init() {
    console.log('🚀 Initializing Entity Store...');
    try {
        await sql`
            CREATE TABLE IF NOT EXISTS msajce_entities (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                role TEXT,
                department TEXT,
                batch TEXT,
                context TEXT,
                source_url TEXT,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );
        `;
        console.log('✅ msajce_entities table is ready.');
    } catch (e: any) {
        console.error('❌ DB Init Failed:', e.message);
    } finally {
        await sql.end();
    }
}

init();
