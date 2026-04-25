import postgres from 'postgres';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
dotenv.config();

const sql = postgres(process.env.DATABASE_URL!, { ssl: 'require' });

async function lightningBatchRestore() {
    console.log('⚡ STAGE 1: Selective Wipe (Preserving Transport & Developer)...');
    await sql`DELETE FROM msajce_entities WHERE department != 'Transport' AND role NOT ILIKE '%Developer%'`;

    console.log('🧠 STAGE 2: High-Fidelity Batch Scanning...');
    const detailedDir = path.join(process.cwd(), 'data', 'raw_detailed');
    const files = fs.readdirSync(detailedDir).filter(f => f.endsWith('.detailed.txt'));
    
    const uniqueMap = new Map();
    const noisePatterns = [/TABLE/, /SUMMARY/, /SL NO/, /S\.NO/, /TOTAL/, /FACULTY/, /STAFF/, /STUDENT/, /DEPARTMENT/, /LIST/, /NIRF/, /CLICK/];

    for (const file of files) {
        const content = fs.readFileSync(path.join(detailedDir, file), 'utf8');
        const deptName = file.replace('.detailed.txt', '').toUpperCase();
        const rows = content.split('\n').filter(line => line.includes('|'));

        for (const row of rows) {
            const parts = row.split('|').map(p => p.trim()).filter(p => p.length > 0);
            if (parts.length >= 3) {
                let name = parts[1];
                let role = parts[2];
                if (/^\d+$/.test(name) && parts.length > 3) {
                    name = parts[2];
                    role = parts[3];
                }

                if (!name || name.length < 5) continue;
                if (noisePatterns.some(p => p.test(name.toUpperCase()))) continue;

                const cleanName = name.replace(/\s+/g, ' ').trim();
                const cleanRole = role.replace(/\s+/g, ' ').trim() || 'Personnel';

                // Skip if it looks like a heading (ALL CAPS and long)
                if (cleanName === cleanName.toUpperCase() && cleanName.split(' ').length > 6) continue;

                if (!uniqueMap.has(cleanName)) {
                    uniqueMap.set(cleanName, {
                        name: cleanName,
                        role: cleanRole,
                        department: deptName,
                        context: `Role: ${cleanRole} | Dept: ${deptName} | Source: ${file}`
                    });
                }
            }
        }
    }

    const entities = Array.from(uniqueMap.values());
    console.log(`📡 Scan Complete. ${entities.length} verified human identities found.`);

    // 🏎️ STAGE 3: Lightning Batch Insert (Chunked)
    const chunkSize = 100;
    let totalInjected = 0;

    for (let i = 0; i < entities.length; i += chunkSize) {
        const chunk = entities.slice(i, i + chunkSize);
        await sql`
            INSERT INTO msajce_entities ${sql(chunk, 'name', 'role', 'department', 'context')}
            ON CONFLICT (name) DO UPDATE 
            SET role = EXCLUDED.role, department = EXCLUDED.department, context = EXCLUDED.context
        `;
        totalInjected += chunk.length;
        console.log(`💨 Lightning Speed: ${totalInjected}/${entities.length} injected...`);
    }

    console.log('✅ UNIVERSAL BATCH RESTORATION COMPLETE. Database is now at peak fidelity.');
    await sql.end();
}

lightningBatchRestore().catch(console.error);
