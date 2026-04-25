import postgres from 'postgres';
import dotenv from 'dotenv';
dotenv.config();

const sql = postgres(process.env.DATABASE_URL!, { ssl: 'require' });

async function injectDrivers() {
    console.log('🚀 Injecting Full Driver Directory...');
    
    const drivers = [
        { name: 'Mr. Sathish K', role: 'Driver (Route AR-3)', dept: 'Transport', context: 'Driver for Route AR-3: Uthiramerur to College. Contact: +91-9789970304' },
        { name: 'Mr. M. Suresh', role: 'Driver (Route AR-4 & R-20)', dept: 'Transport', context: 'Driver for Route AR-4 / R-20: Moolakadai to College. Contact: +91-9849265637' },
        { name: 'Mr. Velu', role: 'Driver (Route AR-5 / N-3)', dept: 'Transport', context: 'Driver for Route AR-5 / N-3: MMDA School to College. Contact: +91-9940050685' },
        { name: 'Mr. Venkatachalam', role: 'Driver (Route AR-6)', dept: 'Transport', context: 'Driver for Route AR-6: ICF / Purasawalkam to College. Contact: +91-9025731746' },
        { name: 'Mr. Suresh', role: 'Driver (Route AR-7)', dept: 'Transport', context: 'Driver for Route AR-7: Chunambedu to College. Contact: +91-9789895025' },
        { name: 'Mr. Raju', role: 'Driver (Route AR-8)', dept: 'Transport', context: 'Driver for Route AR-8: Manjambakkam to College. He covers CMBT, Vadapalani, and Medavakkam. Contact: +91-9790750906' },
        { name: 'Mr. Kanagaraj', role: 'Driver (Route AR-9)', dept: 'Transport', context: 'Driver for Route AR-9: Ennore to College. Contact: +91-9710209097' },
        { name: 'Mr. E. Sathish', role: 'Driver (Route R-21)', dept: 'Transport', context: 'Driver for Route R-21: Porur to College. Contact: +91-9677007583' },
        { name: 'Mr. Jaffar', role: 'Driver (Route R-22)', dept: 'Transport', context: 'Driver for Route R-22: Nemilichery to College. Contact: +91-9566037890' }
    ];

    for (const d of drivers) {
        await sql`DELETE FROM msajce_entities WHERE name = ${d.name} AND role = ${d.role}`;
        await sql`
            INSERT INTO msajce_entities (name, role, department, context, source_url)
            VALUES (${d.name}, ${d.role}, ${d.dept}, ${d.context}, 'personal profile and transport detailed.txt')
        `;
    }

    console.log('✅ 9 Primary Drivers Injected. Raju is officially in the system.');
    await sql.end();
}

injectDrivers();
