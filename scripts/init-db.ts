import postgres from 'postgres';
import dotenv from 'dotenv';
dotenv.config();

const sql = postgres(process.env.DATABASE_URL!);

async function init() {
    console.log('⏳ INITIALIZING SUPABASE MEMORY TABLE...');
    try {
        await sql`
            CREATE TABLE IF NOT EXISTS chat_history (
                id SERIAL PRIMARY KEY,
                user_id BIGINT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                session_id TEXT,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );
        `;
        
        // Add index for fast retrieval
        await sql`CREATE INDEX IF NOT EXISTS idx_chat_history_user_id ON chat_history(user_id);`;

        // ── Long-Term User Profiles (Lorin v2) ──────────────────────────────
        await sql`
            CREATE TABLE IF NOT EXISTS lorin_user_profiles (
                user_id     TEXT PRIMARY KEY,
                name        TEXT,
                interest    TEXT,
                stage       TEXT DEFAULT 'unknown',
                last_seen   TIMESTAMPTZ DEFAULT NOW(),
                strikes       INT DEFAULT 0,
                blocked_until TIMESTAMPTZ
            );
        `;

        // Safely add columns if doing migration
        await sql`ALTER TABLE lorin_user_profiles ADD COLUMN IF NOT EXISTS strikes INT DEFAULT 0;`.catch(() => {});
        await sql`ALTER TABLE lorin_user_profiles ADD COLUMN IF NOT EXISTS blocked_until TIMESTAMPTZ;`.catch(() => {});

        console.log('✅ CHAT_HISTORY + USER_PROFILES TABLES ARE READY');
        process.exit(0);
    } catch (err) {
        console.error('❌ DB INIT ERROR:', err);
        process.exit(1);
    }
}

init();
