import postgres from 'postgres';
import dotenv from 'dotenv';
dotenv.config();

const sql = postgres(process.env.DATABASE_URL!, { ssl: 'require' });

async function hardenSchema() {
    console.log('🏗️ Hardening Database Schema: Adding Unique Constraint to Name...');
    
    // Add unique constraint to the name column to allow ON CONFLICT updates properly
    try {
        await sql`
            ALTER TABLE msajce_entities 
            ADD CONSTRAINT unique_entity_name UNIQUE (name)
        `;
        console.log('✅ Unique Constraint Added.');
    } catch (e: any) {
        if (e.code === '42710') {
            console.log('❕ Constraint already exists. Proceeding.');
        } else {
            console.error('❌ Failed to add constraint:', e);
        }
    }

    await sql.end();
}

hardenSchema();
