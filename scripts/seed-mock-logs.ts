import fs from 'fs-extra';
import path from 'path';

const LOG_FILE = path.join(process.cwd(), 'logs', 'audit.jsonl');

const mockLogs = [
    { timestamp: new Date().toISOString(), userId: "123456", sessionId: "tg_123_s1", query: "who is principal", answer: "Dr. K. S. Srinivasan...", source: "CACHE", latency: 45, tokens: 0, cost: 0, spam: false, abuse: false, score: 1.0, k: 0, model: "N/A" },
    { timestamp: new Date().toISOString(), userId: "654321", sessionId: "tg_654_s1", query: "tambaram bus timings", answer: "Use Route R 21...", source: "SENTINEL", latency: 90, tokens: 0, cost: 0, spam: false, abuse: false, score: 1.0, k: 0, model: "N/A" },
    { timestamp: new Date().toISOString(), userId: "999999", sessionId: "tg_999_s1", query: "waste college MSAJCE", answer: "Oh, so you think...", source: "QDRANT_VECTOR", latency: 1200, tokens: 180, cost: 0.000027, spam: false, abuse: true, score: 0.88, k: 3, model: "gpt-4o-mini" },
    { timestamp: new Date().toISOString(), userId: "888888", sessionId: "tg_888_s1", query: "what is the mess menu today", answer: "I don't have that info...", source: "SUPABASE_FALLBACK", latency: 1500, tokens: 45, cost: 0.000006, spam: false, abuse: false, score: 0.12, k: 1, model: "gpt-4o-mini" },
    { timestamp: new Date().toISOString(), userId: "777777", sessionId: "tg_777_s1", query: "sipcot entrance arrival time", answer: "Buses reach SIPCOT at 07:50 AM", source: "SENTINEL", latency: 30, tokens: 0, cost: 0, spam: false, abuse: false, score: 1.0, k: 0, model: "N/A" },
    { timestamp: new Date().toISOString(), userId: "666666", sessionId: "tg_666_s1", query: "admission eligibility for AIDS", answer: "A PASS in HSC...", source: "QDRANT_VECTOR", latency: 2100, tokens: 250, cost: 0.000037, spam: false, abuse: false, score: 0.94, k: 4, model: "gpt-4o-mini" },
    { timestamp: new Date().toISOString(), userId: "111111", sessionId: "tg_111_s1", query: "Kaiveli stop for AR 8", answer: "Kaiveli is at 06:55 AM", source: "CACHE", latency: 12, tokens: 0, cost: 0, spam: false, abuse: false, score: 1.0, k: 0, model: "N/A" },
    { timestamp: new Date().toISOString(), userId: "222222", sessionId: "tg_222_s1", query: "spam spam spam spam", answer: "Wow you type fast!", source: "SENTINEL", latency: 5, tokens: 0, cost: 0, spam: true, abuse: false, score: 1.0, k: 0, model: "N/A" },
    { timestamp: new Date().toISOString(), userId: "333333", sessionId: "tg_333_s1", query: "how is placement in IT", answer: "MSAJCE has great ties...", source: "QDRANT_VECTOR", latency: 1800, tokens: 210, cost: 0.000031, spam: false, abuse: false, score: 0.82, k: 3, model: "gpt-4o-mini" },
    { timestamp: new Date().toISOString(), userId: "444444", sessionId: "tg_444_s1", query: "where is the gym", answer: "Gym facilities are near...", source: "SUPABASE_FALLBACK", latency: 2500, tokens: 120, cost: 0.000018, spam: false, abuse: false, score: 0.65, k: 2, model: "gpt-4o-mini" }
];

async function seedMockData() {
    await fs.ensureDir(path.dirname(LOG_FILE));
    const data = mockLogs.map(log => JSON.stringify(log)).join('\n') + '\n';
    await fs.writeFile(LOG_FILE, data);
    console.log('✅ 10 Real-world Mock Interactions seeded.');
}

seedMockData();
