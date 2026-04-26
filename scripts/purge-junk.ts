import postgres from 'postgres';
import dotenv from 'dotenv';

dotenv.config();

const sql = postgres(process.env.DATABASE_URL!, { ssl: 'require' });

async function purgeJunk() {
    console.log('🧹 Initializing Deep Database Purge...');

    try {
        // 1. Delete rows with percentages in Name or Role (Classic scraper debris)
        const resPercentage = await sql`
            DELETE FROM msajce_entities 
            WHERE name ~* '[0-9]+\\.?[0-9]*%' 
            OR role ~* '[0-9]+\\.?[0-9]*%'
        `;
        console.log(`✅ Removed percentage-based debris.`);

        // 2. Delete rows with generic labels and missing personnel data
        const junkNames = [
            'Community', 'General Category', 'Backward Class', 'MBC & DNC', 
            'Eligibility', 'Income should be less than', 'Qualification', 
            'Subject Code', 'Subject Name', 'Name of the Alumni', 
            'General Category', 'Income should be less than 10000 per mo',
            'Backward Class including Backward Clas', 'Intro to Intermed Interpersonal Skills'
        ];

        const resJunk = await sql`
            DELETE FROM msajce_entities 
            WHERE name IN ${sql(junkNames)}
        `;
        console.log(`✅ Removed ${resJunk.count} generic label rows.`);

        // 3. Delete rows where name starts with numbers (Misaligned ID columns)
        const resNumbered = await sql`
            DELETE FROM msajce_entities 
            WHERE name ~ '^[0-9]'
        `;
        console.log(`✅ Removed numbered fragments.`);

        console.log('✨ Database sanitized! Only real persons and valid roles should remain.');
    } catch (error) {
        console.error('❌ Purge failed:', error);
    } finally {
        process.exit(0);
    }
}

purgeJunk();
