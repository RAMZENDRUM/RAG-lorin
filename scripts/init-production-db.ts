import postgres from 'postgres';
import dotenv from 'dotenv';
dotenv.config();

const sql = postgres(process.env.DATABASE_URL!, { ssl: 'require' });

async function init() {
    console.log('🚀 Initializing Production Database Schema...');
    try {
        // 1. Audit Logs (for reporting)
        await sql`
            CREATE TABLE IF NOT EXISTS lorin_audit_logs (
                id SERIAL PRIMARY KEY,
                data JSONB NOT NULL,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );
        `;
        console.log('✅ Audit Log table ready.');

        // 2. Chat History (for memory)
        await sql`
            CREATE TABLE IF NOT EXISTS chat_history (
                id SERIAL PRIMARY KEY,
                user_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );
        `;
        console.log('✅ Chat History table ready.');

        // 3. User Profiles (for Matryoshka memory)
        await sql`
            CREATE TABLE IF NOT EXISTS user_profiles (
                user_id TEXT PRIMARY KEY,
                interest TEXT,
                last_seen TIMESTAMPTZ DEFAULT NOW(),
                data JSONB DEFAULT '{}'
            );
        `;
        console.log('✅ User Profiles table ready.');

        // 4. Knowledge Base (for keyword search)
        await sql`
            CREATE TABLE IF NOT EXISTS lorin_knowledge (
                id SERIAL PRIMARY KEY,
                content TEXT UNIQUE,
                metadata JSONB,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );
        `;
        // Ensure constraint is loose as per previous fix
        await sql`ALTER TABLE lorin_knowledge DROP CONSTRAINT IF EXISTS lorin_knowledge_content_key;`;
        console.log('✅ Knowledge Base table ready.');

        console.log('🌟 DATABASE ALIGNED FOR PRODUCTION.');
    } catch (e: any) {
        console.error('❌ DB Init Failed:', e.message);
    } finally {
        await sql.end();
    }
}

init();
