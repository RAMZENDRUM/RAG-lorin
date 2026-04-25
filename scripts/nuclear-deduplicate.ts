import postgres from 'postgres';
import dotenv from 'dotenv';
dotenv.config();

const sql = postgres(process.env.DATABASE_URL!, { ssl: 'require' });

async function nuclearDeduplicate() {
    console.log('🏗️ STAGE 1: Splitting Concatenated Name Chunks...');
    
    const messyEntities = await sql`SELECT * FROM msajce_entities WHERE name ~ '.*(Dr\.|Mr\.).*(Dr\.|Mr\.).*'`;
    
    for (const messy of messyEntities) {
        // Split by Dr. or Mr. using lookahead which correctly separates mashed names
        const parts = messy.name.split(/(?=[DM][rs]\.)/g).filter(p => p.trim().length > 0);
        if (parts && parts.length > 1) {
            console.log(`✂️ Splitting concatenated row: [${messy.name}]`);
            for (const part of parts) {
                await sql`
                    INSERT INTO msajce_entities (name, role, department, type, email, phone, context)
                    VALUES (${part.trim()}, ${messy.role}, ${messy.department}, 'PERSON', ${messy.email}, ${messy.phone}, ${messy.context})
                    ON CONFLICT (name) DO NOTHING
                `;
            }
            await sql`DELETE FROM msajce_entities WHERE name = ${messy.name}`;
        }
    }

    console.log('🧠 STAGE 2: Token-Based Fuzzy Deduplication...');
    const all = await sql`SELECT * FROM msajce_entities`;
    const seenTokens = new Map<string, any>();
    const toDelete: string[] = [];

    for (const entity of all) {
        // Tokenize: Remove titles, split by space/dot, sort, and join
        const tokens = entity.name
            .replace(/Dr\.|Mr\.|Mrs\.|Ms\.|Prof\./gi, '')
            .replace(/\./g, ' ')
            .split(/\s+/)
            .filter(t => t.length > 0)
            .map(t => t.toLowerCase())
            .sort()
            .join('-');
        
        const key = `${tokens}-${entity.department?.toLowerCase()}`;

        if (seenTokens.has(key)) {
            const original = seenTokens.get(key);
            console.log(`♻️ Found Token Match: [${entity.name}] mirrors [${original.name}]. Merging...`);
            
            // Merge contact info to the original
            await sql`
                UPDATE msajce_entities 
                SET 
                    email = COALESCE(email, ${entity.email}),
                    phone = COALESCE(phone, ${entity.phone}),
                    linkedin = COALESCE(linkedin, ${entity.linkedin}),
                    portfolio = COALESCE(portfolio, ${entity.portfolio})
                WHERE name = ${original.name}
            `;
            toDelete.push(entity.name);
        } else {
            seenTokens.set(key, entity);
        }
    }

    if (toDelete.length > 0) {
        await sql`DELETE FROM msajce_entities WHERE name IN (${toDelete})`;
        console.log(`✅ Deleted ${toDelete.length} mirrored records.`);
    }

    console.log('🌟 NUCLEAR DEDUPLICATION COMPLETE.');
    await sql.end();
}

nuclearDeduplicate().catch(console.error);
