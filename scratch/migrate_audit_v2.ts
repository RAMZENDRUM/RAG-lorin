import postgres from 'postgres';
import dotenv from 'dotenv';
dotenv.config();

const sql = postgres(process.env.DATABASE_URL!, { ssl: 'require' });

async function migrateAuditTable() {
    console.log('🚀 Upgrading audit_feedback table for SaaS-Grade Forensics...');
    try {
        await sql`ALTER TABLE audit_feedback ADD COLUMN IF NOT EXISTS intent_category TEXT`;
        await sql`ALTER TABLE audit_feedback ADD COLUMN IF NOT EXISTS retrieval_source TEXT`;
        await sql`ALTER TABLE audit_feedback ADD COLUMN IF NOT EXISTS response_type TEXT`;
        await sql`ALTER TABLE audit_feedback ADD COLUMN IF NOT EXISTS latency_ms INTEGER`;
        await sql`ALTER TABLE audit_feedback ADD COLUMN IF NOT EXISTS tokens_used INTEGER`;
        await sql`ALTER TABLE audit_feedback ADD COLUMN IF NOT EXISTS cost_usd DECIMAL(10,6)`;
        await sql`ALTER TABLE audit_feedback ADD COLUMN IF NOT EXISTS match_score DECIMAL(5,4)`;
        await sql`ALTER TABLE audit_feedback ADD COLUMN IF NOT EXISTS chunks_count INTEGER`;
        await sql`ALTER TABLE audit_feedback ADD COLUMN IF NOT EXISTS failure_reason TEXT`;
        await sql`ALTER TABLE audit_feedback ADD COLUMN IF NOT EXISTS model_id TEXT`;
        
        console.log('✅ Audit table successfully upgraded with 10 forensic columns.');
    } catch (err) {
        console.error('🔴 Migration Failed:', err);
    } finally {
        await sql.end();
    }
}

migrateAuditTable();
