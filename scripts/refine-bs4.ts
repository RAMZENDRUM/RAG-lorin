import fs from 'fs-extra';
import path from 'path';
import crypto from 'crypto';

const RAW_DIR = 'data/raw_bs4';
const UNIFIED_PATH = 'data/unified_cleaned_data.json';

async function unify() {
    const allFiles = fs.readdirSync(RAW_DIR);
    let allChunks: any[] = [];

    console.log(`🧹 Unifying ${allFiles.length} deep-mine files...`);

    for (const file of allFiles) {
        const content = fs.readFileSync(path.join(RAW_DIR, file), 'utf-8');
        const category = file.replace('.txt', '').toUpperCase();
        
        // Split by double newline or [TABLE markers
        const sections = content.split(/(\[TABLE \d+\])/g).filter(s => s.trim().length > 10);

        sections.forEach((section, i) => {
            const cleanContent = section.trim();
            const chunkId = crypto.createHash('md5').update(cleanContent).digest('hex');
            
            allChunks.push({
                index: allChunks.length,
                content: `Source: ${file} | Category: ${category} | Data: ${cleanContent}`,
                metadata: {
                    source: file,
                    category: category,
                    id: chunkId,
                    timestamp: new Date().toISOString()
                }
            });
        });
    }

    fs.writeJsonSync(UNIFIED_PATH, allChunks, { spaces: 2 });
    console.log(`✅ Success! Created ${allChunks.length} high-fidelity chunks.`);
}

unify();
