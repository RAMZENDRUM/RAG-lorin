import type { VercelRequest, VercelResponse } from '@vercel/node';

export default function handler(req: VercelRequest, res: VercelResponse) {
    res.status(200).json({ 
        status: 'Lorin Health Check', 
        time: new Date().toISOString(),
        env: {
            token: !!process.env.TELEGRAM_BOT_TOKEN,
            qdrant: !!process.env.QDRANT_URL
        }
    });
}
