import { performLorinRetrieval } from '../lib/retrieve.js';
import dotenv from 'dotenv';

dotenv.config();

async function debug() {
    const query = "What is the bus timing for Porur?";
    const result = await performLorinRetrieval(query);
    console.log('--- DEBUG RESULTS ---');
    console.log('Answer:', result.answer);
    console.log('Score:', result.score);
    if (result.chunks) {
        console.log('Top Context Chunks:');
        result.chunks.forEach((c, i) => console.log(`[${i}] ${c.substring(0, 100)}...`));
    }
}

debug();
