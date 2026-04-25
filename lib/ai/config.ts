import { createOpenAI } from '@ai-sdk/openai';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Returns a configured OpenAI client with load-balancing across multiple keys.
 */
export function getDynamicAIClient() {
    const keys = [
        process.env.VERCEL_AI_KEY,
        process.env.VERCEL_AI_KEY_2,
        process.env.VERCEL_AI_KEY_3,
        process.env.VERCEL_AI_KEY_4
    ].filter(Boolean);
    
    // Pick a random key or fallback to default
    const key = keys.length > 0 
        ? keys[Math.floor(Math.random() * keys.length)] 
        : process.env.OPENAI_API_KEY;
    
    return createOpenAI({ 
        apiKey: key,
        // Use Vercel AI Gateway if configured
        baseURL: process.env.VERCEL_AI_GATEWAY_URL || 'https://api.openai.com/v1'
    });
}
