import postgres from 'postgres';
import dotenv from 'dotenv';
dotenv.config();

const sql = postgres(process.env.DATABASE_URL!, { ssl: 'require' });

async function purgeAndFix() {
    console.log('🧹 Cleaning up the Yogesh/Saqlin hallucination...');
    
    // Delete the bad ones
    await sql`DELETE FROM msajce_entities WHERE name ILIKE '%Yogesh%' OR name ILIKE '%Saqlin%'`;
    
    // Insert correctly
    await sql`
        INSERT INTO msajce_entities (name, role, department, batch, context, source_url)
        VALUES 
        ('Yogesh R', 'President (CSI Student Branch)', 'IT', '2022-2026', 'Yogesh R is the President of the CSI Student Branch at MSAJCE.', 'professionalsocities.detailed.txt'),
        ('Saqlin Mustaq M', 'Vice President (CSI Student Branch)', 'AI&DS', '2023-2027', 'Saqlin Mustaq M is the Vice President of the CSI Student Branch at MSAJCE.', 'professionalsocities.detailed.txt')
    `;

    console.log('✅ FIXED: Yogesh R and Saqlin Mustaq M are now distinct and accurate.');
    await sql.end();
}

purgeAndFix();
