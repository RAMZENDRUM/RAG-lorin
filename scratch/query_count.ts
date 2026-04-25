import postgres from 'postgres';
import dotenv from 'dotenv';
dotenv.config();

const sql = postgres(process.env.DATABASE_URL!, { ssl: 'require' });

async function runCount() {
    try {
        const result = await sql`
            SELECT count(*) as total 
            FROM msajce_entities 
            WHERE context IS NOT NULL 
            AND length(trim(context)) > 5
        `;
        console.log('--- DB INTEGRITY AUDIT ---');
        console.log(`📊 Total Entities with Rich Content: ${result[0].total}`);
    } catch (err) {
        console.error('Error:', err);
    } finally {
        await sql.end();
    }
}

runCount();
