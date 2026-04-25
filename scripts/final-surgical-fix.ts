import postgres from 'postgres';
import dotenv from 'dotenv';
dotenv.config();

const sql = postgres(process.env.DATABASE_URL!, { ssl: 'require' });

async function finalCleanup() {
    console.log('🧹 One last surgical cleanup...');
    
    // Total wipe for these specific names again to be safe
    await sql`DELETE FROM msajce_entities WHERE name ILIKE '%Yogesh%' OR name ILIKE '%Saqlin%'`;
    
    // Insert with NO AMBIGUITY
    await sql`
        INSERT INTO msajce_entities (name, role, department, batch, context, source_url)
        VALUES 
        ('Dr. Elliss Yogesh R', 'Professor', 'Civil Engineering', null, 'Dr. Elliss Yogesh R is a Professor in the Civil Engineering department. He specializes in Environmental Engineering.', 'civil.detailed.txt'),
        ('Yogesh R', 'President (CSI Student Branch)', 'IT', '2022-2026', 'Yogesh R is the President of the CSI Student Branch and a student in the IT department.', 'professionalsocities.detailed.txt'),
        ('Saqlin Mustaq M', 'Vice President (CSI Student Branch)', 'AI&DS', '2023-2027', 'Saqlin Mustaq M is the Vice President of the CSI Student Branch and an AI&DS student.', 'professionalsocities.detailed.txt')
    `;

    console.log('✅ Surgical Cleanup COMPLETE. Memory Overwrite Rule 6 is Pushed.');
    await sql.end();
}

finalCleanup();
