import type { VercelRequest, VercelResponse } from '@vercel/node';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export default async function handler(req: VercelRequest, res: VercelResponse) {
    // 🛡️ Basic Protection: Ensure it's a Cron request (simple check)
    // In production, Vercel adds a specific header: x-vercel-cron: 1
    if (process.env.NODE_ENV === 'production' && req.headers['x-vercel-cron'] !== '1') {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        console.log('🚀 Triggering Sunday Intelligence Dispatch...');
        // We run the script using npx tsx to handle the TS environment within the serverless function
        const { stdout, stderr } = await execAsync('npx tsx scripts/sunday-intelligence.ts');
        
        if (stderr) console.error('stderr:', stderr);
        console.log('stdout:', stdout);

        return res.status(200).json({ success: true, message: 'Sunday Dispatch Complete' });
    } catch (error: any) {
        console.error('❌ Sunday Dispatch Failed:', error);
        return res.status(500).json({ error: error.message });
    }
}
