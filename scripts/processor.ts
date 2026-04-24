import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import crypto from 'crypto';

dotenv.config();

const VERCEL_KEY = process.env.VERCEL_AI_KEY || '';
const openai = createOpenAI({ 
    apiKey: VERCEL_KEY,
    baseURL: 'https://ai-gateway.vercel.sh/v1'
});
const model = openai('gpt-4o-mini');

// --- HIGH-QUALITY REFINER (Skill: Semantic Enrichment) ---
async function refineContent(rawText: string, filename: string) {
    console.log(`🚀 Deep Refining: ${filename}...`);
    
    const { text } = await generateText({
        model,
        system: `You are an Elite Data Engineer for a University RAG system.
        
        GOAL: Transform raw web-scraped content into high-fidelity "RAG-ready" blocks.
        
        INSTRUCTIONS:
        1. CONTEXTUAL HEADERS: Prepend a summary header to the text if the file is about a specific person or department.
        2. DATA RECONSTRUCTION: Convert all tables and list-based contact details into descriptive sentences. 
           - Bad: "Name: Ram | Dept: IT"
           - Good: "Ramanathan S (Ram) is a student in the IT department at MSAJCE."
        3. DENSITY: Preserve all phone numbers and emails EXACTLY.
        4. CLEANING: Strip out navigation menus, footers, and redundant web boilerplate.
        5. TONE: Professional, objective, and informative.`,
        prompt: `FILENAME: ${filename}\n\nRAW CONTENT:\n${rawText.substring(0, 10000)}`
    });
    
    return text;
}

// --- RECURSIVE CHUNKER (Skill: Overlap & Context) ---
function createHighQualityChunks(text: string, filename: string, category: string) {
    const CHUNK_SIZE = 600;
    const OVERLAP = 100;
    const chunks = [];
    
    // Prefix for every chunk to preserve "Subject Knowledge"
    const prefix = `[Entity: MSAJCE | Category: ${category} | Source: ${filename}] `;
    
    let start = 0;
    while (start < text.length) {
        let end = start + CHUNK_SIZE;
        let chunk = text.substring(start, end);
        
        // Enrich and Store
        chunks.push({
            content: prefix + chunk.trim(),
            length: chunk.length
        });
        
        start += (CHUNK_SIZE - OVERLAP);
    }
    
    return chunks;
}

async function main() {
    const rawDir = path.join(process.cwd(), 'data', 'raw');
    const processedDir = path.join(process.cwd(), 'data', 'processed');
    const unifiedPath = path.join(process.cwd(), 'data', 'unified_cleaned_data.json');
    
    if (!fs.existsSync(processedDir)) fs.mkdirSync(processedDir, { recursive: true });
    
    const files = fs.readdirSync(rawDir).filter(f => f.endsWith('.txt'));
    const allChunks = [];

    for (const file of files) {
        const filePath = path.join(rawDir, file);
        const processedPath = path.join(processedDir, `${file.replace('.txt', '')}.hq.txt`);
        const rawContent = fs.readFileSync(filePath, 'utf-8');
        
        let hqContent = '';
        
        // Always Deep-Refine to ensure high-fidelity context (Ignore cache for now for total quality)
        console.log(`Processing ${file}...`);
        hqContent = await refineContent(rawContent, file);
        fs.writeFileSync(processedPath, hqContent);

        const category = file.replace('.txt', '').replace(/[\-_]/g, ' ');
        const chunks = createHighQualityChunks(hqContent, file, category);
        
        for (const chunk of chunks) {
            const hash = crypto.createHash('md5').update(chunk.content).digest('hex');
            allChunks.push({
                index: allChunks.length,
                content: chunk.content,
                metadata: {
                    id: hash,
                    source: file,
                    category: category,
                    timestamp: new Date().toISOString()
                }
            });
        }
    }
    
    fs.writeFileSync(unifiedPath, JSON.stringify(allChunks, null, 2));
    console.log(`\n✅ HIGH-QUALITY PROCESSING COMPLETE!`);
    console.log(`Generated ${allChunks.length} HQ chunks with Context Overlap.`);
    console.log(`Saved to: ${unifiedPath}`);
}

main().catch(console.error);
