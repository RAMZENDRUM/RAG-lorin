import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const VERCEL_URL = process.env.VERCEL_PROJECT_URL || "YOUR_VERCEL_APP_URL"; // e.g. "https://rag-lorin.vercel.app"

async function setWebhook() {
    const webhookUrl = `${VERCEL_URL}/api/bot`;
    console.log(`📡 Connecting Lorin to Webhook: ${webhookUrl}`);

    try {
        const response = await axios.get(`https://api.telegram.org/bot${BOT_TOKEN}/setWebhook?url=${webhookUrl}`);
        console.log('✅ Webhook Response:', response.data);
    } catch (error: any) {
        console.error('❌ Error setting webhook:', error.response?.data || error.message);
    }
}

setWebhook();
