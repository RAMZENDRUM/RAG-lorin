import postgres from 'postgres';
import dotenv from 'dotenv';
dotenv.config();

const sql = postgres(process.env.DATABASE_URL!, { ssl: 'require' });

async function surgicalContextPurge() {
    console.log('🏗️ STAGE 1: Purging Mashed Names from Context strings...');
    
    // We target context strings that contain multiple titles (Mr. Dr. etc)
    const entities = await sql`SELECT id, name, context FROM msajce_entities WHERE context ~ '.*(Mr\.|Dr\.).*(Mr\.|Dr\.).*'`;
    
    for (const entity of entities) {
        console.log(`🧼 Cleaning context for: [${entity.name}]`);
        // Remove occurrences of other people's names from the context
        // This is a simple but effective clean: keep only context after the last 'as' or just keep the descriptive part
        const cleanContext = entity.context.replace(/[DM][rs]\.[^|]+\|/g, '').replace(/[DM][rs]\.[^|]+$/g, '').trim();
        
        await sql`UPDATE msajce_entities SET context = ${cleanContext} WHERE id = ${entity.id}`;
    }

    console.log('🧠 STAGE 2: Fixing Research/Patent titles in Role column...');
    // If role starts with 'A method' or is very long, it's a project, not a role.
    const messyRoles = await sql`SELECT id, name, role, context FROM msajce_entities WHERE role ILIKE 'A method%' OR length(role) > 50`;
    
    for (const messy of messyRoles) {
        console.log(`🛠️ Fixing role for: [${messy.name}]`);
        const newAbout = `${messy.role} | ${messy.context || ''}`;
        await sql`UPDATE msajce_entities SET role = 'Faculty / Researcher', context = ${newAbout} WHERE id = ${messy.id}`;
    }

    console.log('🌟 SURGICAL CONTEXT PURGE COMPLETE.');
    await sql.end();
}

surgicalContextPurge().catch(console.error);
