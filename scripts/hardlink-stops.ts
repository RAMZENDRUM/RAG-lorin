import postgres from 'postgres';
import dotenv from 'dotenv';
dotenv.config();

const sql = postgres(process.env.DATABASE_URL!, { ssl: 'require' });

async function hardLinkStops() {
    console.log('🏗️ Hardlining ALL Transport Stops...');
    
    const updates = [
        { bus: 'AR-8', stops: 'Manjambakkam, Retteri, Senthil Nagar, Padi, Anna Nagar, Thirumangalam, CMBT, Vadapalani, Ashok Pillar, Kasi Theatre, Ekkattuthangal, Aadampakkam, Kaiveli, PALLIKARANAI, MEDAVAKKAM, Perumpakkam, Sholinganallur' },
        { bus: 'AR-5', stops: 'MMDA School, Anna Nagar, Chinthamani, Skywalk, Choolaimadu, Loyola College, T. Nagar, CIT Nagar, Saidapet, Velachery Check Post, Vijaya Nagar, Baby Nagar, Tharamani, MGR Road, OMR' },
        { bus: 'R-22', stops: 'Nemilichery, Poonamallee, Kumanan Chavadi, Kattupakkam, Ramachandra Hospital, Porur, Valasaravakkam, Ramapuram, Nandhampakkam, Kathipara, VELACHERY, Kaiveli, Madipakkam, Kilkattalai, Kovilambakkam, Medavakkam' }
    ];

    for (const u of updates) {
        await sql`
            UPDATE msajce_entities 
            SET context = ${'Full Route Stops: ' + u.stops + '. Driver details in separate record.'}
            WHERE role LIKE ${'%' + u.bus + '%'}
        `;
    }

    console.log('✅ Stops linked. Search engine update required.');
    await sql.end();
}

hardLinkStops();
