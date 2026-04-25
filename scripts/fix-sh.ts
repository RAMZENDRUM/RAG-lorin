import fs from 'fs';
import path from 'path';
import { generateText } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import dotenv from 'dotenv';
dotenv.config();

const openrouter = createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY });
async function run() {
    console.log('🌐 OpenRouter: Transforming SH...');
    const rawContent = fs.readFileSync('data/02_unified/sh.unified.txt', 'utf-8');
    const { text } = await generateText({
        model: openrouter('meta-llama/llama-3.3-70b-instruct'),
        system: "You are a data structuring engine. OUTPUT MUST USE [SECTION] HEADERS. LIST EVERY SINGLE NAME OF FACULTY. DO NOT SUMMARIZE.",
        prompt: "INPUT DATA:\n\n" + rawContent.slice(0, 25000),
    });
    fs.writeFileSync('data/04_semantic/sh.semantic.txt', text);
    console.log('✅ SH COMPLETED VIA OPENROUTER');
    process.exit(0);
}
run();
