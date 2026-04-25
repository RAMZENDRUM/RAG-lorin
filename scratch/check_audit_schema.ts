import postgres from 'postgres';
import dotenv from 'dotenv';
dotenv.config();

const sql = postgres(process.env.DATABASE_URL!, { ssl: 'require' });

async function checkSchema() {
    try {
        const columns = await sql`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'audit_feedback'
        `;
        console.log('--- AUDIT_FEEDBACK SCHEMA ---');
        console.table(columns);
    } catch (err) {
        console.error('Error checking schema:', err);
    } finally {
        await sql.end();
    }
}

checkSchema();
