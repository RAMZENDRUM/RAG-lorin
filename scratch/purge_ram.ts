import { QdrantClient } from '@qdrant/js-client-rest';
import dotenv from 'dotenv';
dotenv.config();

const client = new QdrantClient({ 
    url: process.env.QDRANT_URL!, 
    apiKey: process.env.QDRANT_API_KEY! 
});

async function manualPurgeRam() {
    try {
        console.log('🚀 Scanning Qdrant for identity ghosts...');
        const results = await client.scroll('lorin_msajce_knowledge', { 
            limit: 500,
            with_payload: true
        });

        const ghosts = results.points.filter(p => {
            const content = (p.payload?.content as string) || '';
            return content.includes('Ramanathan S') && !content.includes('linkedin.com');
        });

        if (ghosts.length > 0) {
            console.log(`🔎 Found ${ghosts.length} legacy chunks. Wiping memory...`);
            const ids = ghosts.map(p => p.id);
            await client.delete('lorin_msajce_knowledge', { 
                wait: true, 
                points: ids 
            });
            console.log('✅ Identity Hallucination Purged.');
        } else {
            console.log('ℹ️ No identity ghosts found in the latest 500 chunks.');
        }
    } catch (err) {
        console.error('❌ Manual Purge Failed:', err);
    }
}

manualPurgeRam();
