import postgres from 'postgres';
import dotenv from 'dotenv';

dotenv.config();

const sql = postgres(process.env.DATABASE_URL!, { ssl: 'require' });

async function upgrade() {
    console.log('🆙 Evolving Database Schema...');
    try {
        await sql`ALTER TABLE msajce_entities ADD COLUMN IF NOT EXISTS type TEXT`;
        await sql`ALTER TABLE msajce_entities ADD COLUMN IF NOT EXISTS designation TEXT`;
        await sql`ALTER TABLE msajce_entities ADD COLUMN IF NOT EXISTS degree TEXT`;
        await sql`ALTER TABLE msajce_entities ADD COLUMN IF NOT EXISTS organization TEXT DEFAULT 'MSAJCE'`;
        await sql`ALTER TABLE msajce_entities ADD COLUMN IF NOT EXISTS search_text TEXT`;
        console.log('✅ Schema Evolved Successfully!');
    } catch (error) {
        console.error('❌ Schema upgrade failed:', error);
    } finally {
        process.exit(0);
    }
}

upgrade();
