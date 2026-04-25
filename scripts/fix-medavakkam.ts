import postgres from 'postgres';
import dotenv from 'dotenv';
dotenv.config();

const sql = postgres(process.env.DATABASE_URL!, { ssl: 'require' });

async function fixMedavakkam() {
    console.log('🏗️ Hardlining Medavakkam Connections...');
    
    // Update AR-8 Context to mention Medavakkam explicitly for fuzzy search
    await sql`
        UPDATE msajce_entities 
        SET context = 'Driver: Mr. Raju (+91-9790750906). FULL ROUTE: Manjambakkam -> Retteri -> Senthil Nagar -> Padi -> Anna Nagar -> Thirumangalam -> Vijaykanth -> CMBT -> Vadapalani -> Ashok Pillar -> Kasi Theatre -> Ekkattuthangal -> Aadampakkam -> Kaiveli -> Pallikaranai -> MEDAVAKKAM -> Perumpakkam -> Sholinganallur -> Ladies Hostel -> M.S.A.J.C.E'
        WHERE role LIKE '%AR-8%'
    `;

    // Same for R-21
    await sql`
        UPDATE msajce_entities 
        SET context = 'Driver: Mr. E. Sathish (+91-9677007583). FULL ROUTE: Porur -> Boy Kadai -> Kovoor -> Kundrathur -> Anagaputhur -> Pammal -> Pallavaram -> Meenambakkam -> Chrompet -> Tambaram -> Camp Road -> Saliyur -> MEDAVAKKAM -> Chithalapakkam -> Thalambur -> M.S.A.J.C.E'
        WHERE role LIKE '%R-21%'
    `;

    console.log('✅ Medavakkam is now hard-linked to AR-8 and R-21.');
    await sql.end();
}

fixMedavakkam();
