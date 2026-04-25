import postgres from 'postgres';
import dotenv from 'dotenv';
dotenv.config();

const sql = postgres(process.env.DATABASE_URL!, { ssl: 'require' });

async function migrate() {
    console.log('🔄 Creating rate_limits table...');
    try {
        await sql`
            CREATE TABLE IF NOT EXISTS rate_limits (
                user_id TEXT PRIMARY KEY,
                minute_count INT DEFAULT 0,
                day_count INT DEFAULT 0,
                last_minute TIMESTAMPTZ DEFAULT NOW(),
                last_day TIMESTAMPTZ DEFAULT NOW()
            )
        `;
        console.log('✅ Table created or verified.');
        
        const check = await sql`SELECT * FROM information_schema.tables WHERE table_name = 'rate_limits'`;
        console.log('📊 Verification Result:', check.length > 0 ? 'EXISTENT' : 'FAILED');
    } catch (err) {
        console.error('❌ Migration Failed:', err);
    } finally {
        await sql.end();
        process.exit(0);
    }
}

migrate();
