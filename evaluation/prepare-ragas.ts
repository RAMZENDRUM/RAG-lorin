import { performLorinRetrieval } from '../lib/retrieve.js';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

async function prepareEval() {
    console.log('--- PREPARING RAGAS EVALUATION DATA ---');
    
    const testSetPath = path.join(process.cwd(), 'data', 'eval_testset.json');
    const testSet = JSON.parse(fs.readFileSync(testSetPath, 'utf-8'));
    
    const evalData = [];

    for (const item of testSet) {
        console.log(`Querying: ${item.question}`);
        const result = await performLorinRetrieval(item.question);
        
        evalData.push({
            question: item.question,
            answer: result.answer,
            contexts: result.chunks || [],
            ground_truth: item.ground_truth
        });
    }

    fs.writeFileSync(
        path.join(process.cwd(), 'data', 'ragas_input.json'),
        JSON.stringify(evalData, null, 2)
    );
    
    console.log('✅ Ragas input generated at data/ragas_input.json');
}

prepareEval();
