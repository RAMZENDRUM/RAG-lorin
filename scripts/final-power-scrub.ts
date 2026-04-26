import postgres from 'postgres';
import dotenv from 'dotenv';
dotenv.config();

const sql = postgres(process.env.DATABASE_URL!, { ssl: 'require' });

async function finalPowerScrub() {
    console.log('🏗️ STAGE 1: Atomic Splitting (Fixing mashed names)...');
    const messy = await sql`SELECT id, name, role, department, type, email, phone FROM msajce_entities WHERE name ~ '.*(Dr\.|Mr\.).*(Dr\.|Mr\.).*'`;
    
    for (const m of messy) {
        const parts = m.name.split(/(?=[DM][rs]\.)/g).filter(p => p.trim().length > 0);
        if (parts.length > 1) {
            console.log(`✂️ Splitting: [${m.name}]`);
            for (const part of parts) {
                await sql`INSERT INTO msajce_entities (name, role, department, type, email, phone) 
                          VALUES (${part.trim()}, ${m.role}, ${m.department}, 'PERSON', ${m.email}, ${m.phone}) 
                          ON CONFLICT DO NOTHING`;
            }
            await sql`DELETE FROM msajce_entities WHERE id = ${m.id}`;
        }
    }

    console.log('🧠 STAGE 2: Global Token Merging (Cross-Department)...');
    const all = await sql`SELECT * FROM msajce_entities ORDER BY id ASC`;
    const seen = new Map<string, any>();
    const deleteIds: number[] = [];

    for (const entity of all) {
        const tokens = entity.name
            .replace(/Dr\.|Mr\.|Mrs\.|Ms\.|Prof\./gi, '')
            .replace(/\./g, ' ')
            .split(/\s+/)
            .filter(t => t.length > 0)
            .map((t: any) => t.toLowerCase())
            .sort()
            .join('-');
        
        if (tokens.length < 3) continue; // Skip very short noise

        if (seen.has(tokens)) {
            const original = seen.get(tokens);
            console.log(`♻️ Merging [${entity.name}] (${entity.department}) into [${original.name}] (${original.department})`);
            
            const mergedDept = original.department === entity.department ? original.department : `${original.department}, ${entity.department}`;
            
            await sql`
                UPDATE msajce_entities 
                SET 
                    department = ${mergedDept},
                    role = COALESCE(role, ${entity.role}),
                    email = COALESCE(email, ${entity.email}),
                    phone = COALESCE(phone, ${entity.phone}),
                    context = ${original.context + ' | ' + (entity.context || '')}
                WHERE id = ${original.id}
            `;
            deleteIds.push(entity.id);
        } else {
            seen.set(tokens, entity);
        }
    }

    if (deleteIds.length > 0) {
        await sql`DELETE FROM msajce_entities WHERE id = ANY(${deleteIds})`;
        console.log(`✅ Successfully purged ${deleteIds.length} duplicate IDs.`);
    }

    console.log('🌟 GLOBAL POWER SCRUB COMPLETE.');
    await sql.end();
}

finalPowerScrub().catch(console.error);
