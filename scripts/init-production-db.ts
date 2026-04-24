import postgres from 'postgres';
import dotenv from 'dotenv';
dotenv.config();

const sql = postgres(process.env.DATABASE_URL!, { ssl: 'require' });

async function init() {
    console.log('🚀 Finalizing Production Database Schema (Full Alignment)...');
    try {
        // 1. User Profiles (Full Schema)
        await sql`
            CREATE TABLE IF NOT EXISTS user_profiles (
                user_id TEXT PRIMARY KEY,
                name TEXT,
                interest TEXT,
                stage TEXT DEFAULT 'unknown',
                last_seen TIMESTAMPTZ DEFAULT NOW(),
                strikes INTEGER DEFAULT 0,
                blocked_until TIMESTAMPTZ,
                data JSONB DEFAULT '{}'
            );
        `;
        
        // Ensure columns exist if table was already created
        await sql`ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS name TEXT;`;
        await sql`ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS stage TEXT DEFAULT 'unknown';`;
        await sql`ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS strikes INTEGER DEFAULT 0;`;
        await sql`ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS blocked_until TIMESTAMPTZ;`;
        
        console.log('✅ User Profiles schema fully aligned.');

        // 2. Audit Logs
        await sql`
            CREATE TABLE IF NOT EXISTS lorin_audit_logs (
                id SERIAL PRIMARY KEY,
                data JSONB NOT NULL,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );
        `;
        console.log('✅ Audit Log table ready.');

        // 3. Chat History
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

        console.log('🌟 DATABASE FULLY SYNCHRONIZED.');
    } catch (e: any) {
        console.error('❌ DB Update Failed:', e.message);
    } finally {
        await sql.end();
    }
}

init();
