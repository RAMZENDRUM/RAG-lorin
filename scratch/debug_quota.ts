import postgres from 'postgres';
import dotenv from 'dotenv';
dotenv.config();

const sql = postgres(process.env.DATABASE_URL!, { ssl: 'require' });

async function debug() {
    console.log('--- RATE LIMIT LOGS ---');
    const limits = await sql`SELECT * FROM rate_limits ORDER BY last_minute DESC LIMIT 5`;
    console.table(limits);

    console.log('\n--- ADMIN IDS CONFIG ---');
    console.log('RAW:', process.env.ADMIN_IDS);
    const ADMIN_IDS = (process.env.ADMIN_IDS || "").split(",").map(id => id.trim());
    console.log('PARSED:', ADMIN_IDS);

    process.exit(0);
}

debug();
