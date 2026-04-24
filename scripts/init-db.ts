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
        
        console.log('✅ CHAT_HISTORY TABLE IS READY');
        process.exit(0);
    } catch (err) {
        console.error('❌ DB INIT ERROR:', err);
        process.exit(1);
    }
}

init();
