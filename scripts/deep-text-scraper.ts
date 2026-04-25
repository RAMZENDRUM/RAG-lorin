import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const urls = [
    "https://www.msajce-edu.in/it.php",
    "https://www.msajce-edu.in/mech.php",
    "https://www.msajce-edu.in/placement.php",
    "https://www.msajce-edu.in/research.php",
    "https://www.msajce-edu.in/sh.php",
    "https://www.msajce-edu.in/technologycentrecybersecurityacademy.php",
    "https://www.msajce-edu.in/professionalsocities.php",
    "https://www.msajce-edu.in/about.php",
    "https://www.msajce-edu.in/principal.php"
];

const outputDir = 'data/01_text_only';

async function scrapeDeep() {
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();

    console.log(`🚀 Starting DEEP RECALL Scrape of small files...`);

    for (const url of urls) {
        const fileName = url.split('/').pop()?.replace('.php', '.txt') || 'index.txt';
        const page = await context.newPage();
        
        try {
            console.log(`🌐 Deep Loading: ${url}`);
            await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
            
            // Wait extra for lazy content
            await page.waitForTimeout(5000);

            // Extract text from body AND all iframes
            const allText = await page.evaluate(async () => {
                let combined = document.body.innerText;
                
                // Inspect all iframes
                const iframes = Array.from(document.querySelectorAll('iframe'));
                for (const frame of iframes) {
                    try {
                        const frameDoc = frame.contentDocument || frame.contentWindow?.document;
                        if (frameDoc) {
                            combined += "\n --- IFRAME CONTENT --- \n" + frameDoc.body.innerText;
                        }
                    } catch (e) {}
                }
                return combined;
            });

            const cleanText = allText
                .replace(/\s+/g, ' ')
                .replace(/\n+/g, '\n')
                .trim();

            fs.writeFileSync(path.join(outputDir, fileName), cleanText);
            console.log(`✅ Saved DEEP: ${fileName} (${cleanText.length} chars)`);
        } catch (e: any) {
            console.error(`❌ Failed ${url}: ${e.message}`);
        } finally {
            await page.close();
        }
    }

    await browser.close();
}

scrapeDeep().catch(console.error);
