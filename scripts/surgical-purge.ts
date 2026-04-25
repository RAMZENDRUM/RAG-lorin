import postgres from 'postgres';
import dotenv from 'dotenv';
dotenv.config();

const sql = postgres(process.env.DATABASE_URL!, { ssl: 'require' });

async function surgicalPurge() {
    console.log('🧼 STAGE 1: Identifying and Purging Non-Human Noise...');
    
    // Purge rules:
    // 1. Context or Role contains a URL (http)
    // 2. Name is longer than 50 chars (mostly titles)
    // 3. Name is all lowercase and short (likely scrap)
    // 4. Name contains illegal words like "Activity", "Meeting", "Weblink"
    
    const result = await sql`
        DELETE FROM msajce_entities 
        WHERE (
            (context ILIKE '%http%' OR role ILIKE '%http%')
            OR length(name) > 50
            OR name ILIKE '%Activity%'
            OR name ILIKE '%Meeting%'
            OR name ILIKE '%Weblink%'
            OR name ILIKE '%Destination%'
            OR role = 'View Details'
            OR role ILIKE '%overlook%' -- Catching descriptive text in role
            OR role ILIKE '%phases of%'
            OR role ILIKE '%bridge between%'
            OR name ILIKE '%Lab%'
            OR name ILIKE '%Department%'
            OR name ILIKE '%Online%'
            OR name ILIKE '%Catalogue%'
            OR role = 'II' 
            OR role = 'III'
            OR role = 'IV'
            OR name ILIKE '%Private Limited%'
            OR name ILIKE '%Awareness%'
            OR name ILIKE '%Program%'
            OR name ILIKE '%Rally%'
            OR name ILIKE '%Centre%'
            OR name ILIKE '%Solution%'
            OR name ILIKE '%Scheme%'
            OR name ILIKE '%Scholarship%'
            OR name ILIKE '%Award%'
            OR name ~ '[A-Z]{2,4}[0-9]{3,4}' -- Aggressive Course Code Match
        )
        AND department NOT IN ('Transport', 'AI Engineer')
    `;

    console.log('✅ Purge Complete.');
    
    const count = await sql`SELECT count(*) FROM msajce_entities`;
    console.log(`📊 NEW TOTAL ENTITIES: ${count[0].count}`);
    
    await sql.end();
}

surgicalPurge();
