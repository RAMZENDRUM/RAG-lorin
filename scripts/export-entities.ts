import postgres from 'postgres';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

const sql = postgres(process.env.DATABASE_URL!, { ssl: 'require' });

async function exportEntities() {
    console.log('📡 Fetching all entities from Supabase...');

    try {
        const rows = await sql`SELECT * FROM msajce_entities ORDER BY name ASC`;
        
        const backupDir = path.join(process.cwd(), 'data', 'backups');
        if (!fs.existsSync(backupDir)) {
            fs.mkdirSync(backupDir, { recursive: true });
        }

        const filePath = path.join(backupDir, 'msajce_entities_full_export.json');
        fs.writeFileSync(filePath, JSON.stringify(rows, null, 2));

        console.log(`✅ Export Complete! ${rows.length} entities saved to:`);
        console.log(`📍 ${filePath}`);
    } catch (error) {
        console.error('❌ Export failed:', error);
    } finally {
        process.exit(0);
    }
}

exportEntities();
