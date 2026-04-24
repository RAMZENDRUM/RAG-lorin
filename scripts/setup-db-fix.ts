import postgres from 'postgres';
import dotenv from 'dotenv';
dotenv.config();

const sql = postgres(process.env.DATABASE_URL!, { ssl: 'require' });

async function fix() {
    console.log('🛠️ Loosening database constraints for high-fidelity data...');
    try {
        await sql`ALTER TABLE lorin_knowledge DROP CONSTRAINT IF EXISTS lorin_knowledge_content_key;`;
        console.log('✅ Unique constraint dropped! Large table support enabled.');
    } catch (e: any) {
        console.error('❌ Failed to update schema:', e.message);
    }
}

fix();
