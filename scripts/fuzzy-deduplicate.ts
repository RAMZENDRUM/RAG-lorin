import postgres from 'postgres';
import dotenv from 'dotenv';
dotenv.config();

const sql = postgres(process.env.DATABASE_URL!, { ssl: 'require' });

async function fuzzyDeduplicate() {
    console.log('🏗️ STAGE 1: Fetching all entities for fuzzy analysis...');
    const entities = await sql`SELECT * FROM msajce_entities`;
    
    console.log(`🧠 STAGE 2: Analyzing ${entities.length} entities for duplicates...`);
    
    const seen = new Map<string, any>();
    const toDelete: string[] = [];
    const toUpdate: { id: string, email: string, phone: string, context: string }[] = [];

    for (const entity of entities) {
        // Normalize name: Remove titles, dots, and spaces
        const baseName = entity.name
            .replace(/Dr\.|Mr\.|Mrs\.|Ms\.|Miss|Prof\.|Dr|Mr|Mrs|Ms|Prof/gi, '')
            .replace(/\./g, '')
            .trim()
            .toLowerCase();
        
        const key = `${baseName}-${entity.department?.toLowerCase()}`;

        if (seen.has(key)) {
            const original = seen.get(key);
            console.log(`♻️ Found duplicate: [${entity.name}] matches [${original.name}]`);
            
            // Merge Data: Keep the best info
            const mergedEmail = original.email || entity.email;
            const mergedPhone = original.phone || entity.phone;
            const mergedContext = original.context?.length > entity.context?.length ? original.context : entity.context;

            // Mark the current one for deletion
            toDelete.push(entity.name); // Using name for the unique delete if IDs aren't sequential
            
            // Update the original with merged data
            toUpdate.push({
                id: original.name, // Using name as the key for now since we know it's unique enough for this pass
                email: mergedEmail,
                phone: mergedPhone,
                context: mergedContext
            });
        } else {
            seen.set(key, entity);
        }
    }

    console.log(`🛡️ STAGE 3: Committing Merges and Deleting ${toDelete.length} duplicates...`);
    
    for (const update of toUpdate) {
        await sql`
            UPDATE msajce_entities 
            SET email = ${update.email}, phone = ${update.phone}, context = ${update.context}
            WHERE name = ${update.id}
        `;
    }

    if (toDelete.length > 0) {
        await sql`DELETE FROM msajce_entities WHERE name IN (${toDelete})`;
    }

    console.log('🌟 UNIVERSAL DEDUPLICATION COMPLETE.');
    await sql.end();
}

fuzzyDeduplicate().catch(console.error);
