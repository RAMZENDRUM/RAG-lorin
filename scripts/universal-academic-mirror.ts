import postgres from 'postgres';
import dotenv from 'dotenv';
dotenv.config();

const sql = postgres(process.env.DATABASE_URL!, { ssl: 'require' });

async function universalAcademicMirror() {
    console.log('🏗️ Mirroring ALL Official Academic Programs into High-Priority Truth Table...');
    
    const programs = [
        // UG Programs
        { name: 'Civil Engineering', role: 'Undergraduate Programme (BE)', dept: 'Civil', context: 'Sanctioned Intake: 30 seats. Focused on structural design, construction, and infrastructure.' },
        { name: 'Computer Science & Engineering', role: 'Undergraduate Programme (BE)', dept: 'CSE', context: 'Sanctioned Intake: 60 seats (Permanent Affiliation). Core computing, software engineering, and systems.' },
        { name: 'Electronics & Communication Engineering', role: 'Undergraduate Programme (BE)', dept: 'ECE', context: 'Sanctioned Intake: 60 seats. Focus on signal processing, VLSI, and communication systems.' },
        { name: 'Electrical & Electronics Engineering', role: 'Undergraduate Programme (BE)', dept: 'EEE', context: 'Sanctioned Intake: 30 seats. Focus on power systems, electrical machines, and electronics.' },
        { name: 'Mechanical Engineering', role: 'Undergraduate Programme (BE)', dept: 'Mechanical', context: 'Sanctioned Intake: 30 seats (Permanent Affiliation). Focus on thermodynamics, mechanics, and manufacturing.' },
        { name: 'Information Technology', role: 'Undergraduate Programme (B.Tech)', dept: 'IT', context: 'Sanctioned Intake: 60 seats. Focus on information systems, web tech, and database management.' },
        { name: 'Artificial Intelligence & Data Science', role: 'Undergraduate Programme (B.Tech)', dept: 'AI&DS', context: 'Sanctioned Intake: 30 seats. Focus on machine learning, big data, and neural networks.' },
        { name: 'Computer Science & Business Systems', role: 'Undergraduate Programme (B.Tech)', dept: 'CSBS', context: 'Sanctioned Intake: 30 seats. Collaborative course with TCS focused on tech and business.' },
        { name: 'Computer Science & Engineering (Cyber Security)', role: 'Undergraduate Programme (BE)', dept: 'Cyber Security', context: 'Sanctioned Intake: 30 seats. Focus on network security, ethics, and digital forensics.' },
        { name: 'Artificial Intelligence & Machine Learning', role: 'Undergraduate Programme (BE)', dept: 'AI&ML', context: 'Sanctioned Intake: 60 seats. Deep specialization in AI and automation.' },
        { name: 'Electronics Engineering (VLSI Design & Technology)', role: 'Undergraduate Programme (BE)', dept: 'VLSI', context: 'Sanctioned Intake: 30 seats. High-growth field in chip design.' },
        { name: 'ECE (Advanced Communication Technology)', role: 'Undergraduate Programme (BE)', dept: 'ACT', context: 'Sanctioned Intake: 30 seats. Focus on 5G/6G and satellite comms.' },
        // PG Programs
        { name: 'M.E. Computer Science and Engineering', role: 'Postgraduate Programme (ME)', dept: 'CSE', context: 'Sanctioned Intake: 9 seats. Advanced research in CSE.' },
        { name: 'M.E. Structural Engineering', role: 'Postgraduate Programme (ME)', dept: 'Civil', context: 'Sanctioned Intake: 18 seats. Specialization in advanced structural design.' }
    ];

    for (const p of programs) {
        // Upsert to ensure we update existing ones or add new ones
        await sql`
            INSERT INTO msajce_entities (name, role, department, context)
            VALUES (${p.name}, ${p.role}, ${p.dept}, ${p.context})
            ON CONFLICT (name) DO UPDATE 
            SET role = ${p.role}, department = ${p.dept}, context = ${p.context}
        `;
    }

    console.log('✅ ALL Official Programs Mirrored. Context awareness hardened.');
    await sql.end();
}

universalAcademicMirror();
