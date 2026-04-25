import postgres from 'postgres';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
dotenv.config();

const sql = postgres(process.env.DATABASE_URL!, { ssl: 'require' });

async function restoreAllUniversalTruths() {
    console.log('🏗️ MISSION: Restore Staff, Faculty, Students, and Master Drivers...');
    
    const detailedDir = path.join(process.cwd(), 'data', 'raw_detailed');
    const files = fs.readdirSync(detailedDir).filter(f => f.endsWith('.detailed.txt'));
    
    let totalRestored = 0;
    const entityBatch: any[] = [];

    // 1. EXTRACT FROM RAW TABLES
    for (const file of files) {
        const content = fs.readFileSync(path.join(detailedDir, file), 'utf8');
        const deptName = file.replace('.detailed.txt', '').toUpperCase();
        
        const rows = content.split('\n').filter(line => line.includes('|') && /\d+/.test(line.split('|')[1] || ''));

        for (const row of rows) {
            const parts = row.split('|').map(p => p.trim()).filter(p => p.length > 0);
            if (parts.length >= 4) {
                const name = parts[1];
                const role = parts[2].includes('.') ? (parts[3] || 'Personnel') : parts[2];
                const context = `Dept: ${deptName} | Details: ${parts.slice(2).join(' | ')}`;

                if (name && name.length > 3 && !name.toLowerCase().includes('name')) {
                    entityBatch.push({ name, role, department: deptName, context });
                }
            }
        }
    }

    // 2. MASTER ENTITIES (The High-Priority Truths)
    const masterTruths = [
        { name: 'Ramanathan S', role: 'Lead AI Developer & System Architect', dept: 'AI Engineer', context: 'System Creator (Ram). Primary Authority.' },
        { name: 'Ram', role: 'Lead AI Developer', dept: 'AI Engineer', context: 'The architect of the Lorin AI system.' },
        { name: 'Mr. Raju', role: 'Driver (Route AR-8)', dept: 'Transport', context: 'Phone: +91-9790750906. Route: Manjambakkam -> Medavakkam.' },
        { name: 'Mr. Velu', role: 'Driver (Route AR-5)', dept: 'Transport', context: 'Phone: +91-9940050685. Route: MMDA School -> Velachery.' },
        { name: 'Mr. E. Sathish', role: 'Driver (Route R-21)', dept: 'Transport', context: 'Phone: +91-9677007583. Route: Porur -> Medavakkam.' },
        { name: 'Mr. Perumal', role: 'Driver (Route AR-3)', dept: 'Transport', context: 'Phone: +91-9840245053. Route: C-T-H Road.' },
        { name: 'Mr. Saravanan', role: 'Driver (Route AR-9)', dept: 'Transport', context: 'Phone: +91-9500139194. Route: Thiruverkadu -> Mangadu.' },
        { name: 'Mr. V. Rajendran', role: 'Driver (Route R-10)', dept: 'Transport', context: 'Phone: +91-6380695420. Route: Perambur -> Purasaiwakkam.' },
        { name: 'Mr. Saravanan (R-17)', role: 'Driver (Route R-17)', dept: 'Transport', context: 'Phone: +91-9790924089. Route: Ambattur -> Villivakkam.' },
        { name: 'Mr. Ganesan', role: 'Driver (Route R-20)', dept: 'Transport', context: 'Phone: +91-9962456488. Route: Kundrathur -> Pammal.' },
        { name: 'Mr. Selvam', role: 'Driver (Route R-22)', dept: 'Transport', context: 'Phone: +91-9840430030. Route: Poonamallee -> Medavakkam.' }
    ];

    console.log(`🔍 Found ${entityBatch.length} Faculty/Staff. Adding ${masterTruths.length} Master Truths...`);

    const allEntities = [...masterTruths, ...entityBatch];

    for (const entity of allEntities) {
        try {
            await sql`
                INSERT INTO msajce_entities (name, role, department, context)
                VALUES (${entity.name}, ${entity.role}, ${entity.department}, ${entity.context})
                ON CONFLICT (name) DO UPDATE 
                SET role = EXCLUDED.role, department = EXCLUDED.department, context = EXCLUDED.context
            `;
            totalRestored++;
        } catch (e: any) {}
    }

    console.log(`✅ MISSION COMPLETE. Total Entities in Truth Table: ${totalRestored}`);
    await sql.end();
}

restoreAllUniversalTruths().catch(console.error);
