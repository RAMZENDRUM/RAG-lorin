import postgres from 'postgres';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
dotenv.config();

const sql = postgres(process.env.DATABASE_URL!, { ssl: 'require' });

async function precisionRestoration() {
    console.log('🧹 STAGE 1: Selective Wipe (Preserving Drivers & Developer)...');
    // Wipe everything EXCEPT Transport and Developer roles
    await sql`
        DELETE FROM msajce_entities 
        WHERE department != 'Transport' 
        AND role NOT ILIKE '%Developer%'
    `;
    console.log('✅ Wipe Complete. Transport Convener and Drivers are Safe.');

    console.log('🧠 STAGE 2: Scanning for Human Identities (Staff, Faculty, Students)...');
    
    const detailedDir = path.join(process.cwd(), 'data', 'raw_detailed');
    const files = fs.readdirSync(detailedDir).filter(f => f.endsWith('.detailed.txt'));
    
    const uniqueMap = new Map(); // For deduplication

    for (const file of files) {
        const content = fs.readFileSync(path.join(detailedDir, file), 'utf8');
        const deptName = file.replace('.detailed.txt', '').toUpperCase();
        
        // Target rows that look like table entries: | 1 | Name | ... |
        const rows = content.split('\n').filter(line => line.includes('|'));

        for (const row of rows) {
            const parts = row.split('|').map(p => p.trim()).filter(p => p.length > 0);
            
            // Heuristic for Human Entries: 
            // 1. Must have at least 3 columns.
            // 2. Col 1 (index 1) should be a name (not a number, not a title).
            if (parts.length >= 3) {
                let nameCandidate = parts[1];
                let roleCandidate = parts[2];
                
                // If col 1 is just a number (S.No), move to col 2
                if (/^\d+$/.test(nameCandidate) && parts.length > 3) {
                    nameCandidate = parts[2];
                    roleCandidate = parts[3];
                }

                // VALIDATION RULES:
                const isHeading = nameCandidate.toUpperCase() === nameCandidate && nameCandidate.split(' ').length > 5;
                const isInstruction = nameCandidate.toLowerCase().includes('click') || nameCandidate.toLowerCase().includes('rule');
                const isShort = nameCandidate.length < 5;
                const isGeneric = ['NAME', 'DESIGNATION', 'DEPARTMENT', 'QUALIFICATION', 'S.NO', 'SL.NO'].includes(nameCandidate.toUpperCase());

                if (!isHeading && !isInstruction && !isShort && !isGeneric) {
                    // Clean the name (remove extra spaces/dots)
                    const cleanName = nameCandidate.replace(/\s+/g, ' ').trim();
                    const cleanRole = roleCandidate.replace(/\s+/g, ' ').trim() || 'Personnel';
                    
                    if (!uniqueMap.has(cleanName)) {
                        uniqueMap.set(cleanName, {
                            name: cleanName,
                            role: cleanRole,
                            department: deptName,
                            context: `${cleanName} is listed in ${file} as ${cleanRole} in the ${deptName} department.`
                        });
                    }
                }
            }
        }
    }

    console.log(`🔍 Verified ${uniqueMap.size} distinct human identities. Injecting...`);

    const finalBatch = Array.from(uniqueMap.values());
    let count = 0;

    for (const person of finalBatch) {
        try {
            await sql`
                INSERT INTO msajce_entities (name, role, department, context)
                VALUES (${person.name}, ${person.role}, ${person.department}, ${person.context})
                ON CONFLICT (name) DO UPDATE 
                SET role = EXCLUDED.role, department = EXCLUDED.department, context = EXCLUDED.context
            `;
            count++;
            if (count % 100 === 0) console.log(`🚀 Injected ${count} entities...`);
        } catch (e) {}
    }

    console.log(`✅ PRECISION RESTORATION COMPLETE. ${count} verified entities added to Supabase.`);
    await sql.end();
}

precisionRestoration().catch(console.error);
