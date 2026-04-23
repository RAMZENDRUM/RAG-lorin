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

async function scrape(url: string) {
    console.log(`Scraping ${url}...`);
    try {
        const { data } = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
        });
        const $ = cheerio.load(data);
        
        // Remove script, style, nav, header, footer
        $('script, style, nav, header, footer, noscript').remove();
        
        // Get main content area if possible, or just the body text
        const content = $('main, #content, .content, .container').text() || $('body').text();
        const cleanContent = content.replace(/\s+/g, ' ').trim();
        
        const fileName = url.split('/').pop() || 'index.php';
        const baseName = fileName.replace('.php', '') || 'home';
        
        const htmlFilePath = path.join(process.cwd(), 'data', 'raw', `${baseName}.html`);
        const txtFilePath = path.join(process.cwd(), 'data', 'raw', `${baseName}.txt`);
        
        if (!fs.existsSync(path.dirname(htmlFilePath))) {
            fs.mkdirSync(path.dirname(htmlFilePath), { recursive: true });
        }
        
        fs.writeFileSync(htmlFilePath, data);
        fs.writeFileSync(txtFilePath, cleanContent);
        console.log(`Saved ${baseName}.html and .txt`);
    } catch (error: any) {
        console.error(`Failed to scrape ${url}: ${error.message}`);
    }
}

async function main() {
    for (const url of urls) {
        await scrape(url);
        // Small delay to be polite
        await new Promise(resolve => setTimeout(resolve, 500));
    }
}

main();
