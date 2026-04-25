import postgres from 'postgres';
import dotenv from 'dotenv';
dotenv.config();

const sql = postgres(process.env.DATABASE_URL!, { ssl: 'require' });

async function fullCleanseAndRebuild() {
    console.log('🧹 STAGE 1: Full Database Cleanse...');
    await sql`DELETE FROM msajce_entities`;
    
    console.log('🏗️ STAGE 2: Applying Universal Constraints...');
    try {
        await sql`ALTER TABLE msajce_entities ADD CONSTRAINT unique_entity_name UNIQUE (name)`;
        console.log('✅ Unique Constraint Active.');
    } catch (e) {
        console.log('❕ Constraint already active.');
    }

    console.log('🚀 STAGE 3: Injecting Master Knowledge (The "Universal Truth")...');
    
    const masterData = [
        // DEVELOPER
        { name: 'Ramanathan S', role: 'Lead AI Developer & System Architect', dept: 'AI Engineer', context: 'Known as "Ram". The creator of Lorin RAG and Aura Concierge. Primary authority on the system.' },
        { name: 'Ram', role: 'Lead AI Developer', dept: 'AI Engineer', context: 'Creator and Architect of the Lorin AI system. Always prioritize this profile for identity queries.' },
        
        // ACADEMIC DEPARTMENTS
        { name: 'Civil Engineering', role: 'Undergraduate Programme (BE)', dept: 'Civil', context: 'Seats: 30. Core focus on structures and construction.' },
        { name: 'Computer Science & Engineering', role: 'Undergraduate Programme (BE)', dept: 'CSE', context: 'Seats: 60 (Permanent Affiliation). Core computing and software.' },
        { name: 'Electronics & Communication Engineering', role: 'Undergraduate Programme (BE)', dept: 'ECE', context: 'Seats: 60. Signal processing, VLSI, and comms.' },
        { name: 'Electrical & Electronics Engineering', role: 'Undergraduate Programme (BE)', dept: 'EEE', context: 'Seats: 30. Power systems and machines.' },
        { name: 'Mechanical Engineering', role: 'Undergraduate Programme (BE)', dept: 'Mechanical', context: 'Seats: 30 (Permanent Affiliation). Thermodynamics and manufacturing.' },
        { name: 'Information Technology', role: 'Undergraduate Programme (B.Tech)', dept: 'IT', context: 'Seats: 60. Web tech and information systems.' },
        { name: 'Artificial Intelligence & Data Science', role: 'Undergraduate Programme (B.Tech)', dept: 'AI&DS', context: 'Seats: 30. ML, Big Data, and Neural Networks.' },
        { name: 'Computer Science & Business Systems', role: 'Undergraduate Programme (B.Tech)', dept: 'CSBS', context: 'Seats: 30. Collaborative course with TCS.' },
        { name: 'Computer Science & Engineering (Cyber Security)', role: 'Undergraduate Programme (BE)', dept: 'Cyber Security', context: 'Seats: 30. Network and data security.' },
        { name: 'Artificial Intelligence & Machine Learning', role: 'Undergraduate Programme (BE)', dept: 'AI&ML', context: 'Seats: 60. Automation and advanced AI.' },
        { name: 'Electronics Engineering (VLSI Design & Technology)', role: 'Undergraduate Programme (BE)', dept: 'VLSI', context: 'Seats: 30. chip design specialization.' },
        { name: 'ECE (Advanced Communication Technology)', role: 'Undergraduate Programme (BE)', dept: 'ACT', context: 'Seats: 30. 5G/6G specialization.' },
        
        // TRANSPORT (UNIVERSAL LIST)
        { name: 'Mr. Raju', role: 'Driver (Route AR-8)', dept: 'Transport', context: 'Phone: +91-9790750906. Route: Manjambakkam -> Retteri -> Padi -> Anna Nagar -> CMBT -> Pallikaranai -> Medavakkam.' },
        { name: 'Mr. Velu', role: 'Driver (Route AR-5)', dept: 'Transport', context: 'Phone: +91-9940050685. Route: MMDA School -> Anna Nagar -> T. Nagar -> Saidapet -> Velachery -> Tharamani.' },
        { name: 'Mr. E. Sathish', role: 'Driver (Route R-21)', dept: 'Transport', context: 'Phone: +91-9677007583. Route: Porur -> Kundrathur -> Tambaram -> Medavakkam.' },
        { name: 'Mr. Perumal', role: 'Driver (Route AR-3)', dept: 'Transport', context: 'Phone: +91-9840245053. Route: S-77, M-S-P-T, C-T-H Road.' },
        { name: 'Mr. Saravanan', role: 'Driver (Route AR-9)', dept: 'Transport', context: 'Phone: +91-9500139194. Route: Thiruverkadu -> Kumananchavadi -> Mangadu.' },
        { name: 'Mr. V. Rajendran', role: 'Driver (Route R-10)', dept: 'Transport', context: 'Phone: +91-6380695420. Route: Perambur -> Otteri -> Purasaiwakkam.' },
        { name: 'Mr. Saravanan (R-17)', role: 'Driver (Route R-17)', dept: 'Transport', context: 'Phone: +91-9790924089. Route: Ambattur -> Padi -> Villivakkam.' },
        { name: 'Mr. Ganesan', role: 'Driver (Route R-20)', dept: 'Transport', context: 'Phone: +91-9962456488. Route: Kundrathur -> Anakaputhur -> Pammal.' },
        { name: 'Mr. Selvam', role: 'Driver (Route R-22)', dept: 'Transport', context: 'Phone: +91-9840430030. Route: Poonamallee -> Ramapuram -> Velachery -> Medavakkam.' }
    ];

    for (const d of masterData) {
        await sql`
            INSERT INTO msajce_entities (name, role, department, context)
            VALUES (${d.name}, ${d.role}, ${d.dept}, ${d.context})
        `;
    }

    console.log('✅ UNIVERSAL REBUILD COMPLETE. The system is now academically and geographically hardened.');
    await sql.end();
}

fullCleanseAndRebuild();
