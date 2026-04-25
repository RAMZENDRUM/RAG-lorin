import postgres from 'postgres';
import dotenv from 'dotenv';
dotenv.config();

const sql = postgres(process.env.DATABASE_URL!, { ssl: 'require' });

async function fixAR5() {
    console.log('🏗️ Injecting AR-5 Stop List...');
    
    await sql`
        UPDATE msajce_entities 
        SET context = 'Driver: Mr. Velu (+91-9940050685). FULL ROUTE: MMDA School -> Anna Nagar -> Chinthamani -> Skywalk -> Choolaimadu -> Loyola College -> T. Nagar -> CIT Nagar -> Saidapet -> Velachery Check Post -> Vijaya Nagar Bus Stop -> Baby Nagar -> Tharamani -> MGR Road -> OMR -> Ladies Hostel -> M.S.A.J.C.E'
        WHERE role LIKE '%AR-5%'
    `;

    console.log('✅ AR-5 now has its full stop list in the Truth Table.');
    await sql.end();
}

fixAR5();
