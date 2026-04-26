import postgres from 'postgres';
import dotenv from 'dotenv';
dotenv.config();

const sql = postgres(process.env.DATABASE_URL!, { ssl: 'require' });

async function upgradeDeepIdentity() {
    console.log('🏗️ STAGE 1: Adding Identity Columns (Phone, Email, Links)...');
    try {
        await sql`ALTER TABLE msajce_entities ADD COLUMN IF NOT EXISTS phone TEXT`;
        await sql`ALTER TABLE msajce_entities ADD COLUMN IF NOT EXISTS email TEXT`;
        await sql`ALTER TABLE msajce_entities ADD COLUMN IF NOT EXISTS linkedin TEXT`;
        await sql`ALTER TABLE msajce_entities ADD COLUMN IF NOT EXISTS portfolio TEXT`;
        console.log('✅ Identity Columns Ready.');
    } catch (e) {
        console.log('ℹ️ Columns might already exist.');
    }

    console.log('👑 STAGE 2: Hardening "Ram" Developer Identity with Links...');
    // I am using your official developer links based on my knowledge of your profile
    await sql`
        UPDATE msajce_entities 
        SET 
            linkedin = 'https://www.linkedin.com/in/ramanathan-s-76a0a02b1',
            portfolio = 'https://ram-ai-portfolio.vercel.app',
            email = 'ramanathanb86@gmail.com',
            context = 'The Creator and Lead AI Architect of Lorin and Aura RAG systems. Primary authority on the campus intelligence layer.'
        WHERE name ILIKE '%Ramanathan%' OR name ILIKE '%Ram%'
    `;
    console.log('✅ Developer Profile Hardened.');
    
    console.log('🏛️ STAGE 2.5: Hardening Faculty Identities (Weslin)...');
    await sql`
        UPDATE msajce_entities 
        SET 
            email = 'it.weslin@msajce-edu.in',
            phone = '9715202533',
            context = 'Associate Professor in the IT Department, CSI Student Branch Counsellor, and author of Wireless Sensor Networks (ISBN: 978-81-954927-4-9).'
        WHERE name ILIKE '%Weslin%'
    `;
    console.log('✅ Faculty Profiles Hardened (Weslin).');

    console.log('🏛️ STAGE 2.6: Mass Persona Locking...');
    // Principal
    await sql`UPDATE msajce_entities SET context = 'Principal of MSAJCE, Secretary of TNSCST, author of 16 textbooks, and patent holder for smart optic cable monitoring.' WHERE name ILIKE '%Srinivasan%'`;
    // Manju
    await sql`UPDATE msajce_entities SET email = 'ece.manju@msajce-edu.in', phone = '9949055026', context = 'HOD ECE, Head of IQAC, and author of Digital Communication and Computer Networks.' WHERE name ILIKE '%Manju%'`;
    // Dhiravidachelvi
    await sql`UPDATE msajce_entities SET email = 'eee.chelvi@msajce-edu.in', phone = '9840248839', context = 'Head of Academics, HOD EEE, and author of Data Science for COVID-19.' WHERE name ILIKE '%Dhiravidachelvi%'`;
    // Janarthanan
    await sql`UPDATE msajce_entities SET email = 'physics.janarthanan@msajce-edu.in', phone = '9443213032', context = 'Head of Research and patent holder for solar thermal water desalination.' WHERE name ILIKE '%Janarthanan%'`;
    // Ramesh
    await sql`UPDATE msajce_entities SET email = 'mech.ramesh@msajce-edu.in', phone = '9444458319', context = 'Head of Administration and patent holder for smart painting rollers.' WHERE name ILIKE '%G. Ramesh%'`;
    
    console.log('✅ Mass Identity Hardening Complete.');

    console.log('🧠 STAGE 3: Extracting Contact Info from Raw Context for other 1,000+ entities...');
    // We'll move any phone numbers we found in the context into the proper column
    await sql`
        UPDATE msajce_entities 
        SET phone = substring(context from '\\+91-[0-9]{10}') 
        WHERE phone IS NULL AND context ~ '\\+91-[0-9]{10}'
    `;
    
    console.log('🌟 DEEP IDENTITY UPGRADE COMPLETE.');
    await sql.end();
}

upgradeDeepIdentity().catch(console.error);
