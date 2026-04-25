import fs from 'fs';
import path from 'path';
import { generateText } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import dotenv from 'dotenv';

dotenv.config();

const UNIFIED_DIR = path.join(process.cwd(), 'data/02_unified');
const SEMANTIC_DIR = path.join(process.cwd(), 'data/04_semantic');

if (!fs.existsSync(SEMANTIC_DIR)) fs.mkdirSync(SEMANTIC_DIR, { recursive: true });

const openrouter = createOpenRouter({
    apiKey: process.env.OPENROUTER_API_KEY
});

const MASTER_PROMPT = `You are a data structuring engine for a RAG system.
Your task is to transform raw scraped college data into clean, structured, chunk-optimized knowledge blocks.

OUTPUT REQUIREMENTS:
1. Remove Noise (Menus, Links, Nav, repetitive footers, etc.)
2. Meaningful Sentences (Rewrite fragments into clean, human-readable English)
3. Formatted Blocks: 
   Use [SECTION: Topic Name] as the header for each block.
   Add 2-4 sentences under each header.

4. PRESERVE NAMES & CONTEXT: EVERY SINGLE name must be preserved. 
   CRITICAL: Do NOT simply list names. Write a FULL SENTENCE for each person.
   Example: "Dr. ELLISS YOGESH R is a Professor in the Civil Engineering department specializing in Environmental Engineering."
   NEVER use bullet points or numbered lists for people. ALWAYS use narrative sentences.
   This ensures the retrieval engine can find them easily.

5. One Block = One Idea. Keep segments short (max 150 words).`;

async function transformFile(filename: string) {
    const rawContent = fs.readFileSync(path.join(UNIFIED_DIR, filename), 'utf-8');
    const outputPath = path.join(SEMANTIC_DIR, filename.replace('.unified.txt', '.semantic.txt'));
    
    console.log(`⚡ OpenRouter Transforming: ${filename}...`);
    
    try {
        const { text } = await generateText({
            model: openrouter('meta-llama/llama-3.3-70b-instruct'),
            system: MASTER_PROMPT,
            prompt: `INPUT DATA:\n\n${rawContent.slice(0, 25000)}`,
        });

        fs.writeFileSync(outputPath, text);
        console.log(`✅ Success: ${filename}`);
    } catch (err: any) {
        console.error(`❌ Failed ${filename}:`, err.message);
    }
}

async function startTransformation() {
    // Clear old ones to force narrative update
    const oldFiles = fs.readdirSync(SEMANTIC_DIR);
    oldFiles.forEach(f => fs.unlinkSync(path.join(SEMANTIC_DIR, f)));

    const files = fs.readdirSync(UNIFIED_DIR).filter(f => f.endsWith('.unified.txt'));
    console.log(`🚀 Starting High-Fidelity OpenRouter Narrative Transformation for ${files.length} files...`);

    for (let i = 0; i < files.length; i += 3) {
        const batch = files.slice(i, i + 3);
        await Promise.all(batch.map(f => transformFile(f)));
        await new Promise(r => setTimeout(r, 2000)); // Small sleep
    }
    console.log('✨ ALL FILES COMPLETED VIA OPENROUTER NARRATIVE ENGINE!');
    process.exit(0);
}

startTransformation();
