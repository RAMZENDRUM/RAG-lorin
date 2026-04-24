import axios from 'axios';
import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';

const urls = [
    'https://www.msajce-edu.in/',
    'https://www.msajce-edu.in/about.php',
    'https://www.msajce-edu.in/visionmission.php',
    'https://www.msajce-edu.in/ourhistory.php',
    'https://www.msajce-edu.in/groupofinstitutions.php',
    'https://www.msajce-edu.in/principal.php',
    'https://www.msajce-edu.in/admission.php',
    'https://www.msajce-edu.in/curriculm.php',
    'https://www.msajce-edu.in/departments.php',
    'https://www.msajce-edu.in/research.php',
    'https://www.msajce-edu.in/technologycentre.php',
    'https://www.msajce-edu.in/library.php',
    'https://www.msajce-edu.in/hostel.php',
    'https://www.msajce-edu.in/transport.php',
    'https://www.msajce-edu.in/sports.php',
    'https://www.msajce-edu.in/socialservices.php',
    'https://www.msajce-edu.in/clubssocieties.php',
    'https://www.msajce-edu.in/professionalsocities.php',
    'https://www.msajce-edu.in/alumni.php',
    'https://www.msajce-edu.in/Incubation&Startup.php',
    'https://www.msajce-edu.in/civil.php',
    'https://www.msajce-edu.in/cse.php',
    'https://www.msajce-edu.in/eee.php',
    'https://www.msajce-edu.in/ece.php',
    'https://www.msajce-edu.in/mech.php',
    'https://www.msajce-edu.in/it.php',
    'https://www.msajce-edu.in/aids.php',
    'https://www.msajce-edu.in/csbs.php',
    'https://www.msajce-edu.in/cyber.php',
    'https://www.msajce-edu.in/aiml.php',
    'https://www.msajce-edu.in/ece-vlsi.php',
    'https://www.msajce-edu.in/ece-act.php',
    'https://www.msajce-edu.in/sh.php'
];

const SCRAPE_DO_TOKEN = '548d695b0de1419c862d0d6cecb0b1fc99a83976287';

async function scrape(url: string) {
    const proxyUrl = `http://api.scrape.do?token=${SCRAPE_DO_TOKEN}&url=${encodeURIComponent(url)}`;
    console.log(`Scraping via Scrape.do: ${url}...`);
    
    try {
        const { data } = await axios.get(proxyUrl);
        const $ = cheerio.load(data);
        
        // Remove UI clutter
        $('script, style, nav, footer, noscript, iframe, link, .header, #header, .ticker-wrapper-h').remove();
        
        let target = $('body');
        
        // Strategy: Look for the block with the most paragraph/list content
        const candidates = $('section, .main-content, #main, article, .single-service').toArray();
        let bestContent = '';
        let maxLen = 0;

        for (const cand of candidates) {
            const text = $(cand).text().replace(/\s+/g, ' ').trim();
            if (text.length > maxLen) {
                maxLen = text.length;
                target = $(cand);
                bestContent = text;
            }
        }

        // Convert tables
        target.find('table').each((_, table) => {
            let tableText = '\n[TABLE START]\n';
            $(table).find('tr').each((_, tr) => {
                const cells = $(tr).find('th, td').map((_, cell) => $(cell).text().trim()).get();
                tableText += '| ' + cells.join(' | ') + ' |\n';
            });
            tableText += '[TABLE END]\n';
            $(table).replaceWith(tableText);
        });

        // Convert lists to clear bullets
        target.find('ul, ol').each((_, list) => {
            let listText = '\n';
            $(list).find('li').each((_, li) => {
                const item = $(li).text().trim();
                if (item) listText += `- ${item}\n`;
            });
            $(list).replaceWith(listText);
        });

        const rawText = target.text().replace(/\n\s*\n/g, '\n\n').trim();
        
        const fileName = url.split('/').pop() || 'index.php';
        const baseName = fileName.replace('.php', '') || 'home';
        
        const htmlFilePath = path.join(process.cwd(), 'data', 'raw', `${baseName}.html`);
        const txtFilePath = path.join(process.cwd(), 'data', 'raw', `${baseName}.txt`);
        
        if (!fs.existsSync(path.dirname(htmlFilePath))) {
            fs.mkdirSync(path.dirname(htmlFilePath), { recursive: true });
        }
        
        fs.writeFileSync(htmlFilePath, data);
        fs.writeFileSync(txtFilePath, rawText);
        console.log(`✅ Saved ${baseName}.txt (High Fidelity)`);
    } catch (error: any) {
        console.error(`❌ Failed to scrape ${url}: ${error.message}`);
    }
}

async function main() {
    for (const url of urls) {
        await scrape(url);
        // Delay to respect Scrape.do and server
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
}

main();
