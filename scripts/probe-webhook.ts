import axios from 'axios';

const DOMAINS = [
    'https://rag-lorin.vercel.app/api/bot',
    'https://lorin-rag.vercel.app/api/bot',
    'https://lorin.vercel.app/api/bot'
];

async function probe() {
    const payload = {
        update_id: 12345,
        message: {
            message_id: 1,
            from: { id: 123456, first_name: "Diagnostic" },
            chat: { id: 123456, type: "private" },
            text: "hi"
        }
    };

    for (const url of DOMAINS) {
        console.log(`📡 Probing: ${url}...`);
        try {
            const res = await axios.post(url, payload, { timeout: 5000 });
            console.log(`✅ SUCCESS [200]: ${url}`);
            console.log('Response:', res.data);
            return;
        } catch (e: any) {
            if (e.response) {
                console.log(`❌ FAILED [${e.response.status}]: ${url}`);
                console.log('Error Body:', e.response.data);
            } else {
                console.log(`⚠️ UNREACHABLE: ${url} (${e.message})`);
            }
        }
    }
}

probe();
