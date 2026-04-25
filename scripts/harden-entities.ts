import postgres from 'postgres';
import dotenv from 'dotenv';
dotenv.config();

const sql = postgres(process.env.DATABASE_URL!, { ssl: 'require' });

async function hardening() {
    console.log('🚀 Starting Entity Table Hardening...');
    
    try {
        // 1. Deduplicate
        console.log('🧹 Removing exact duplicates...');
        const deleted = await sql`
            DELETE FROM msajce_entities 
            WHERE id NOT IN (
                SELECT MIN(id) 
                FROM msajce_entities 
                GROUP BY name, role
            )
        `;
        console.log('✅ Deduplication complete.');

        // 2. Enable Fuzzy Search
        console.log('🧠 Enabling Fuzzy Extension (pg_trgm)...');
        await sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`;
        
        console.log('📈 Creating Trigram Indexes for speed...');
        await sql`CREATE INDEX IF NOT EXISTS trgm_idx_name ON msajce_entities USING gin (name gin_trgm_ops)`;
        await sql`CREATE INDEX IF NOT EXISTS trgm_idx_context ON msajce_entities USING gin (context gin_trgm_ops)`;
        
        console.log('✅ msajce_entities is now Fuzzy-Ready.');
        
    } catch (e: any) {
        console.error('❌ Hardening Failed:', e.message);
    } finally {
        await sql.end();
    }
}

hardening();
