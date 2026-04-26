import { execSync } from 'child_process';
import dotenv from 'dotenv';

const env = dotenv.config().parsed;
const token = process.env.VERCEL_TOKEN || process.env.VERCEL_PERSONAL_ACCESS_TOKEN;

if (!env) {
    console.error("❌ No .env file found!");
    process.exit(1);
}

const keysToSync = [
    'TELEGRAM_BOT_TOKEN', 
    'DATABASE_URL', 
    'QDRANT_URL', 
    'QDRANT_API_KEY', 
    'VERCEL_AI_KEY',
    'VERCEL_AI_KEY_2',
    'VERCEL_AI_KEY_3',
    'VERCEL_AI_KEY_4'
];

async function sync() {
    console.log("📡 Starting Environment Sync...");

    for (const key of keysToSync) {
        if (!env) break;
        const value = env[key];
        if (value) {
            try {
                console.log(`📤 Pushing ${key}...`);
                // First remove to avoid conflicts
                try {
                    execSync(`vercel env rm ${key} production --token ${token} --yes`, { stdio: 'ignore' });
                } catch (e) {}

                // Add the fresh value
                execSync(`echo | set /p="${value}" | vercel env add ${key} production --token ${token}`, { stdio: 'inherit' });
            } catch (err) {
                console.error(`❌ Failed to sync ${key}`);
            }
        }
    }
    console.log("✅ Sync Complete!");
}

sync();
