import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';
import dotenv from 'dotenv';

dotenv.config();

const RAW_DIR = path.join(process.cwd(), 'data', 'raw');
const PROCESSED_DIR = path.join(process.cwd(), 'data', 'processed');
const CHUNK_SIZE = 1000;
const OVERLAP = 200;

async function refineContent(rawText: string, filename: string): Promise<string> {
    console.log(`🚀 Deep Refining: ${filename}...`);
    const { text } = await generateText({
        model: openai('gpt-4o-mini'),
        system: `You are an AI data refiner for the Mohamed Sathak A.J. College of Engineering (MSAJCE) RAG system.
        
        INSTRUCTIONS:
        1. CONTEXTUAL HEADERS: Prepend a summary header to the text if the file is about a specific person or department.
        2. DATA RECONSTRUCTION: Convert all tables and list-based contact details into descriptive sentences. 
           - Bad: "Name: Ram | Dept: IT"
           - Good: "Ramanathan S (Ram) is a student in the IT department at MSAJCE."
        3. DENSITY: Preserve all phone numbers, emails, and SPECIFIC DETAILS in brackets (e.g. "English, German & Japan") exactly. These are not general communication skills; they are specific offerings.
        4. CLEANING: Strip out navigation menus, footers, and redundant web boilerplate.
        5. TONE: Professional, objective, and informative.
        6. KEY POINTS: Ensure marketing claims (like "100+ leading IT Industries") are preserved as high-priority bullet points.`,
        prompt: `FILENAME: ${filename}\n\nRAW CONTENT:\n${rawText.substring(0, 15000)}`
    });
    
    return text;
}

function createHighQualityChunks(text: string, source: string, category: string) {
    const chunks = [];
    const prefix = `[Topic: ${category} | Origin: ${source}]\n`;
    
    let start = 0;
    while (start < text.length) {
        let end = start + CHUNK_SIZE;
        let chunk = text.substring(start, end);
        
        chunks.push({
            content: prefix + chunk.trim(),
            metadata: {
                source,
                category,
                timestamp: new Date().toISOString()
            }
        });
        
        start += (CHUNK_SIZE - OVERLAP);
    }
    
    return chunks;
}

async function main() {
    if (!fs.existsSync(PROCESSED_DIR)) fs.mkdirSync(PROCESSED_DIR, { recursive: true });
    
    const files = fs.readdirSync(RAW_DIR).filter(f => f.endsWith('.txt'));
    const allChunks = [];

    for (const file of files) {
        const filePath = path.join(RAW_DIR, file);
        const processedPath = path.join(PROCESSED_DIR, `${file.replace('.txt', '')}.hq.txt`);
        const rawContent = fs.readFileSync(filePath, 'utf-8');
        
        console.log(`Processing ${file}...`);
        const hqContent = await refineContent(rawContent, file);
        fs.writeFileSync(processedPath, hqContent);

        const category = file.replace('.txt', '').replace(/[\-_]/g, ' ');
        const chunks = createHighQualityChunks(hqContent, file, category);
        
        for (const chunk of chunks) {
            const hash = crypto.createHash('md5').update(chunk.content).digest('hex');
            allChunks.push({
                ...chunk,
                metadata: { ...chunk.metadata, id: hash }
            });
        }

        // Safety delay for Vercel AI Free Tier (gpt-4o-mini limits)
        await new Promise(resolve => setTimeout(resolve, 3000));
    }
    
    const unifiedPath = path.join(process.cwd(), 'data', 'unified_cleaned_data.json');
    fs.writeFileSync(unifiedPath, JSON.stringify(allChunks, null, 2));
    console.log(`\n✅ HIGH-QUALITY PROCESSING COMPLETE!`);
}

main().catch(console.error);
