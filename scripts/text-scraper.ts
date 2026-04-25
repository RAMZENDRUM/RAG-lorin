import axios from 'axios';
import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';

const urls = [
    "https://www.msajce-edu.in/about.php",
    "https://www.msajce-edu.in/AC.php",
    "https://www.msajce-edu.in/academicadvisorycommitte.php",
    "https://www.msajce-edu.in/admission.php",
    "https://www.msajce-edu.in/aiml.php",
    "https://www.msajce-edu.in/alumni.php",
    "https://www.msajce-edu.in/Anti-Ragging.php",
    "https://www.msajce-edu.in/BS.php",
    "https://www.msajce-edu.in/civil.php",
    "https://www.msajce-edu.in/clubssocieties.php",
    "https://www.msajce-edu.in/csbs.php",
    "https://www.msajce-edu.in/cse.php",
    "https://www.msajce-edu.in/curriculm.php",
    "https://www.msajce-edu.in/cyber.php",
    "https://www.msajce-edu.in/departments.php",
    "https://www.msajce-edu.in/ebsb.php",
    "https://www.msajce-edu.in/ece-act.php",
    "https://www.msajce-edu.in/ece-vlsi.php",
    "https://www.msajce-edu.in/ece.php",
    "https://www.msajce-edu.in/eee.php",
    "https://www.msajce-edu.in/entrepreneurshipdevelopmentcell.php",
    "https://www.msajce-edu.in/ESE-Timetable.php",
    "https://www.msajce-edu.in/exam-registration.php",
    "https://www.msajce-edu.in/examcell.php",
    "https://www.msajce-edu.in/facilities.php",
    "https://www.msajce-edu.in/faculty-details.php",
    "https://www.msajce-edu.in/faculty-info.php",
    "https://www.msajce-edu.in/faculty.php",
    "https://www.msajce-edu.in/fees-structure.php",
    "https://www.msajce-edu.in/fineartsclub.php",
    "https://www.msajce-edu.in/governingcouncil.php",
    "https://www.msajce-edu.in/grievancecell.php",
    "https://www.msajce-edu.in/h-a.php",
    "https://www.msajce-edu.in/h-ac.php",
    "https://www.msajce-edu.in/h-ad.php",
    "https://www.msajce-edu.in/h-ec.php",
    "https://www.msajce-edu.in/h-iq.php",
    "https://www.msajce-edu.in/h-p.php",
    "https://www.msajce-edu.in/h-r.php",
    "https://www.msajce-edu.in/h-sa.php",
    "https://www.msajce-edu.in/headall.php",
    "https://www.msajce-edu.in/hostel.php",
    "https://www.msajce-edu.in/h-sh.php",
    "https://www.msajce-edu.in/intershipreport.php",
    "https://www.msajce-edu.in/iqac.php",
    "https://www.msajce-edu.in/it.php",
    "https://www.msajce-edu.in/mandatorydisclosure.php",
    "https://www.msajce-edu.in/mech.php",
    "https://www.msajce-edu.in/mtech.php",
    "https://www.msajce-edu.in/NewsLetter.php",
    "https://www.msajce-edu.in/nirf.php",
    "https://www.msajce-edu.in/nss.php",
    "https://www.msajce-edu.in/objective.php",
    "https://www.msajce-edu.in/officallinks.php",
    "https://www.msajce-edu.in/placement.php",
    "https://www.msajce-edu.in/planningmonitoringboard.php",
    "https://www.msajce-edu.in/policy.php",
    "https://www.msajce-edu.in/principal.php",
    "https://www.msajce-edu.in/professionalsocities.php",
    "https://www.msajce-edu.in/research.php",
    "https://www.msajce-edu.in/rotaractclub.php",
    "https://www.msajce-edu.in/scstcell.php",
    "https://www.msajce-edu.in/sh.php",
    "https://www.msajce-edu.in/scholarship.php",
    "https://www.msajce-edu.in/software-incubation.php",
    "https://www.msajce-edu.in/sports.php",
    "https://www.msajce-edu.in/studentaffairs.php",
    "https://www.msajce-edu.in/students.php",
    "https://www.msajce-edu.in/syllabus.php",
    "https://www.msajce-edu.in/technologycentrecybersecurityacademy.php",
    "https://www.msajce-edu.in/timetable.php",
    "https://www.msajce-edu.in/transport.php",
    "https://www.msajce-edu.in/unnatbharatabhiyan.php",
    "https://www.msajce-edu.in/vision-mission.php",
    "https://www.msajce-edu.in/visitor.php",
    "https://www.msajce-edu.in/webteam.php",
    "https://www.msajce-edu.in/womensempowermentcell.php"
];

const outputDir = 'data/01_text_only';

async function scrapeText() {
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    console.log(`🚀 Starting Text-Only Scrape of ${urls.length} pages...`);

    for (const url of urls) {
        const fileName = url.split('/').pop()?.replace('.php', '.txt') || 'index.txt';
        try {
            console.log(`🌐 Scraping: ${url}`);
            const { data: html } = await axios.get(url, { timeout: 10000 });
            const $ = cheerio.load(html);
            
            // Remove noise
            $('script, style, nav, footer, header, .sidebar, .menu').remove();
            
            const text = $('body').text()
                .replace(/\s+/g, ' ')
                .replace(/\n+/g, '\n')
                .trim();

            fs.writeFileSync(path.join(outputDir, fileName), text);
            console.log(`✅ Saved: ${fileName} (${text.length} chars)`);
        } catch (e: any) {
            console.error(`❌ Failed ${url}: ${e.message}`);
        }
    }

    console.log('🌟 TEXT-ONLY SCRAPE COMPLETE.');
}

scrapeText();
