import axios from 'axios';
import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';

const LINKS_FILE = 'data/architecture/master_links.txt';
const DIR_CRAWLER = 'data/raw_crawler';
const DIR_DETAILED = 'data/raw_detailed';

async function dualScrape() {
    const links = fs.readFileSync(LINKS_FILE, 'utf-8')
        .split('\n')
        .map(l => l.trim())
        .filter(l => l && l.startsWith('http'));

    console.log(`🚀 Starting dual-method scrape for ${links.length} URLs...`);

    for (let i = 0; i < links.length; i++) {
        const url = links[i];
        const filename = url.split('/').pop()?.replace('.php', '') || 'index';
        const finalName = filename === 'index' || filename === '' ? 'home' : filename;

        console.log(`[${i+1}/${links.length}] Scraping: ${url}...`);

        try {
            const { data: html } = await axios.get(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                },
                timeout: 15000
            });

            const $ = cheerio.load(html);

            // Removing ONLY scripts and styles
            $('script, style').remove();

            // Method 1: Semantic Markdown-like Crawler
            let crawlerText = `URL: ${url}\nTITLE: ${$('title').text()}\n\n`;
            $('h1, h2, h3, h4, h5, p, li').each((_, el) => {
                const text = $(el).text().trim().replace(/\s+/g, ' ');
                if (text.length > 5) {
                    crawlerText += `${text}\n`;
                }
            });

            // Method 2: Table-Rich Detailed Extractor
            let detailedText = `SOURCE: ${url}\n\n`;
            
            // Extract Tables
            $('table').each((tIdx, table) => {
                detailedText += `\n[TABLE_${tIdx+1}]\n`;
                $(table).find('tr').each((_, tr) => {
                    const row: string[] = [];
                    $(tr).find('th, td').each((_, td) => {
                        row.push($(td).text().trim().replace(/\s+/g, ' '));
                    });
                    if (row.length > 0) detailedText += `| ${row.join(' | ')} |\n`;
                });
            });

            // Extract Body Text (Brute force but safe)
            const bodyContent = $('body').text().trim().replace(/\s+/g, ' ');
            detailedText += `\n\n[FULL_BODY_TEXT]\n${bodyContent}`;

            // Saving
            fs.writeFileSync(path.join(DIR_CRAWLER, `${finalName}.crawler.txt`), crawlerText.trim());
            fs.writeFileSync(path.join(DIR_DETAILED, `${finalName}.detailed.txt`), detailedText.trim());

            console.log(`✅ Saved: ${finalName} (${detailedText.length} bytes)`);



        } catch (err: any) {
            console.error(`❌ Failed: ${url} -> ${err.message}`);
        }

        // Polite delay
        await new Promise(r => setTimeout(r, 200));
    }

    console.log('✨ Dual-method scraping completed!');
}

dualScrape().catch(console.error);
