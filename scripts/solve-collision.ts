import postgres from 'postgres';
import dotenv from 'dotenv';
dotenv.config();

const sql = postgres(process.env.DATABASE_URL!, { ssl: 'require' });

async function solveCollision() {
    console.log('🚀 Solving the Yogesh Collision...');
    
    // Clear the mixed-up ones
    await sql`DELETE FROM msajce_entities WHERE name ILIKE '%Yogesh%'`;
    
    // Insert them as separate, distinct entities
    await sql`
        INSERT INTO msajce_entities (name, role, department, batch, context, source_url)
        VALUES 
        ('Dr. Elliss Yogesh R', 'Professor', 'Civil Engineering', null, 'Dr. Elliss Yogesh R is a Professor in the Civil Engineering department. He holds an M.E. and Ph.D. and has been with the faculty since June 2021.', 'civil.detailed.txt'),
        ('Yogesh R', 'President (CSI Student Branch)', 'IT', '2022-2026', 'Yogesh R is a student in the IT department and currently serves as the President of the Computer Society of India (CSI) student branch.', 'professionalsocities.detailed.txt')
    `;

    console.log('✅ FIXED: Professor Elliss Yogesh and Student Yogesh R are now separate records.');
    await sql.end();
}

solveCollision();
