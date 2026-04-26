import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';

dotenv.config();

// AI Key Rotation Setup
const keys = [
    process.env.VERCEL_AI_KEY,
    process.env.VERCEL_AI_KEY_2,
    process.env.VERCEL_AI_KEY_3,
    process.env.VERCEL_AI_KEY_4
].filter(Boolean);

function getClient(attempt: number = 0) {
    const key = keys[attempt % keys.length];
    return createOpenAI({
        apiKey: key,
        baseURL: "https://ai-gateway.vercel.sh/v1"
    });
}

const STRICT_SYSTEM_PROMPT = `
You are a strict data extraction and validation engine.
Your job is to extract ONLY real human entities (people) from raw institutional data.

🚫 HARD RULE: Reject anything that is NOT a real person.

✅ ACCEPT ONLY IF:
- Full human name exists (e.g., "Dr. K. S. Srinivasan")
- OR clearly identifiable individual (faculty, student, alumni)

❌ REJECT IMMEDIATELY IF:
- Starts with "A seminar", "A session", "Workshop", "Event" (UNLESS it contains a Resource Person name to extract)
- Contains dates (e.g., "08.08.2023")
- Contains routes (e.g., "AR 10", "R21")
- Contains company names
- Contains course names (e.g., "C, C++", "AWS")
- Contains generic roles ("Assistant Professor - IT" without name)
- Contains departments ("CIVIL ENGINEERING")
- Contains plural or group ("All HoDs", "Alumni")
- Contains locations
- Contains random phrases or titles

🔍 VALIDATION CHECKS (MANDATORY):
1. Name must look like a human name (2+ words OR initials + name)
2. Role must relate to that person (NOT event title)
3. Remove noise like: "A Session on...", "Role:", "Dept:"
4. Extract only clean identity.

📦 OUTPUT FORMAT (STRICT JSON):
Respond with a JSON array of objects:
{
  "name": "Full Name",
  "role": "Actual Role (cleaned)",
  "department": "Department (if valid)",
  "type": "PERSON"
}

🧠 CORRECTION RULE:
If raw data contains: "A Session on AI Technology – Resource Person Anisha, Intel"
Then output: {"name": "Anisha", "role": "Resource Person, Intel", "department": "ALUMNI", "type": "PERSON"}

⚠️ CRITICAL:
- NEVER output event names as persons
- NEVER output routes as persons
- If no valid person found in a record -> EXCLUDE it from the array.
`;

async function ironGripAudit() {
    console.log('🦾 Initializing Level 8 Iron-Grip Sanitization...');
    
    const sourcePath = path.join(process.cwd(), 'data', 'backups', 'msajce_entities_full_export.json');
    const outputPath = path.join(process.cwd(), 'data', 'backups', 'msajce_entities_V8_ULTIMATE.json');
    
    if (!fs.existsSync(sourcePath)) {
        console.error('❌ Source file not found!');
        process.exit(1);
    }

    const allEntities = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
    console.log(`📋 Auditing ${allEntities.length} raw records with strict validation...`);

    const batchSize = 30; // Smaller batches for higher extraction quality
    const cleanedEntities = [];

    for (let i = 0; i < allEntities.length; i += batchSize) {
        const batch = allEntities.slice(i, i + batchSize);
        console.log(`⏳ Strict Audit Batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(allEntities.length / batchSize)}...`);

        let success = false;
        for (let attempt = 0; attempt < keys.length; attempt++) {
            try {
                const openai = getClient(attempt);
                const { text } = await generateText({
                    model: openai.chat('gpt-4o-mini'),
                    system: STRICT_SYSTEM_PROMPT,
                    prompt: `Data to extract from: ${JSON.stringify(batch.map(b => ({ name: b.name, role: b.role, dept: b.department })))}`
                });

                const extracted = JSON.parse(text.match(/\[.*\]/s)?.[0] || '[]');
                extracted.forEach(item => {
                    if (item.name && item.name.length > 2) {
                        cleanedEntities.push({
                            name: item.name,
                            role: item.role || 'Personnel',
                            department: item.department || 'General',
                            context: `Verified Entity: ${item.name} | Role: ${item.role}`
                        });
                    }
                });
                success = true;
                break; 
            } catch (error) {
                console.warn(`⚠️ Key ${attempt+1} throttling...`);
                continue;
            }
        }

        if (!success) {
            console.warn(`🛑 Batch at ${i} skipped AI pass due to limits.`);
        }
    }

    fs.writeFileSync(outputPath, JSON.stringify(cleanedEntities, null, 2));
    console.log(`✨ Level 8 Sanitization Complete!`);
    console.log(`✅ Final Verified Count: ${cleanedEntities.length} human entities.`);
    console.log(`📍 Saved to: ${outputPath}`);
}

ironGripAudit();
