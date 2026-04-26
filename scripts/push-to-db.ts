import postgres from 'postgres';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

const sql = postgres(process.env.DATABASE_URL!, { ssl: 'require' });

async function syncVerifiedEntities() {
    console.log('🔄 Initializing Live Database Sync (AI-Verified records)...');
    
    const verifiedPath = path.join(process.cwd(), 'data', 'backups', 'msajce_entities_V8_ULTIMATE.json');
    
    if (!fs.existsSync(verifiedPath)) {
        console.error('❌ Verified file not found! Run neural-cleanup.ts first.');
        process.exit(1);
    }

    const entities = JSON.parse(fs.readFileSync(verifiedPath, 'utf8'));
    console.log(`📦 Preparing to push ${entities.length} verified humans to production.`);

    try {
        await sql.begin(async (sql) => {
            console.log('🗑️ Clearing active entities table...');
            await sql`DELETE FROM msajce_entities`;

            console.log('📤 Inserting verified records...');
            // Batch insert for performance
            const rows = entities.map(e => ({
                name: e.name,
                role: e.role,
                department: e.department,
                context: e.context
            }));

            await sql`INSERT INTO msajce_entities ${sql(rows)}`;
        });

        console.log('✅ LIVE DATABASE SYNCHRONIZED!');
        console.log(`✨ ${entities.length} personnel are now active in the production search engine.`);
    } catch (error) {
        console.error('❌ Sync failed:', error);
    } finally {
        process.exit(0);
    }
}

syncVerifiedEntities();
