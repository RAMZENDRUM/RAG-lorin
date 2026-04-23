import { performLorinRetrieval } from '../lib/retrieve.js';
import dotenv from 'dotenv';

dotenv.config();

const testQueries = [
    "Bus timing from Porur",
    "Placement percentage",
    "Highest salary",
    "What is the contact for AR-8?",
    "Who is the principal of the college?"
];

async function runTests() {
    console.log('--- LORIN VALIDATION TESTS ---\n');
    
    for (const query of testQueries) {
        console.log(`Query: "${query}"`);
        try {
            const result = await performLorinRetrieval(query);
            console.log(`Lorin: ${result.answer}`);
            console.log(`Confidence Score: ${result.score?.toFixed(4) || 'N/A'}`);
            console.log('------------------------------\n');
        } catch (error) {
            console.error(`Error testing query "${query}":`, error);
        }
    }
}

runTests();
