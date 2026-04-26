import postgres from 'postgres';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

const sql = postgres(process.env.DATABASE_URL!, { ssl: 'require' });

async function syncV9Strict() {
    console.log('🔄 Initializing V9 STRICT Semantic Sync...');
    
    const v9Path = path.join(process.cwd(), 'data', 'backups', 'msajce_entities_V9_STRICT.json');
    
    if (!fs.existsSync(v9Path)) {
        console.error('❌ V9 STRICT file not found! Run re-architecture-strict.ts first.');
        process.exit(1);
    }

    const entities = JSON.parse(fs.readFileSync(v9Path, 'utf8'));
    console.log(`📦 Preparing to push ${entities.length} structurally-perfected records.`);

    try {
        await sql.begin(async (sql) => {
            console.log('🗑️ Clearing active entities table...');
            await sql`DELETE FROM msajce_entities`;

            console.log('📤 Inserting V9 STRICT records...');
            const rows = entities.map(e => ({
                name: e.name || null,
                type: e.type || null,
                designation: e.designation || null,
                department: e.department || null,
                degree: e.degree || null,
                batch: e.batch || null,
                organization: e.organization || 'MSAJCE',
                search_text: e.search_text || e.name || null,
                context: `${e.name} is a ${e.type || 'person'} (${e.designation || 'Staff'}) at MSAJCE.`
            }));

            // Process in smaller SQL batches to avoid payload limits
            const chunkSize = 100;
            for (let i = 0; i < rows.length; i += chunkSize) {
                const chunk = rows.slice(i, i + chunkSize);
                await sql`INSERT INTO msajce_entities ${sql(chunk)}`;
                console.log(`✅ Chunk ${Math.floor(i / chunkSize) + 1} pushed.`);
            }
        });

        console.log('✅ DATABASE FULLY PURIFIED AND SYNCHRONIZED!');
    } catch (error) {
        console.error('❌ V9 STRICT Sync failed:', error);
    } finally {
        process.exit(0);
    }
}

syncV9Strict();
