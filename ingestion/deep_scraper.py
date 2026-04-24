import requests
from bs4 import BeautifulSoup
import os
import json
import time
from pathlib import Path

# Configuration
PAGES = [
    ("index", "https://www.msajce-edu.in/"),
    ("about", "https://www.msajce-edu.in/about-us.php"),
    ("admission", "https://www.msajce-edu.in/admission.php"),
    ("infrastructure", "https://www.msajce-edu.in/infrastructure.php"),
    ("it", "https://www.msajce-edu.in/it.php"),
    ("cse", "https://www.msajce-edu.in/cse.php"),
    ("ece", "https://www.msajce-edu.in/ece.php"),
    ("mech", "https://www.msajce-edu.in/mechanical.php"),
    ("eee", "https://www.msajce-edu.in/eee.php"),
    ("civil", "https://www.msajce-edu.in/civil.php"),
    ("aids", "https://www.msajce-edu.in/aids.php"),
    ("aiml", "https://www.msajce-edu.in/aiml.php"),
    ("csbs", "https://www.msajce-edu.in/csbs.php"),
    ("hostel", "https://www.msajce-edu.in/hostel.php"),
    ("placement", "https://www.msajce-edu.in/placement.php")
]

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
}

def extract_data(url):
    print(f"Deep-Mining: {url}")
    try:
        response = requests.get(url, headers=HEADERS, timeout=15)
        response.raise_for_status()
        soup = BeautifulSoup(response.text, 'html.parser')

        # Remove scripts and styles
        for script in soup(["script", "style"]):
            script.extract()

        # 1. Extract ALL Tables
        tables_text = ""
        tables = soup.find_all('table')
        for i, table in enumerate(tables):
            tables_text += f"\n[TABLE {i+1}]\n"
            rows = table.find_all('tr')
            for row in rows:
                cols = row.find_all(['td', 'th'])
                # Prepend the headers if it's the first row for context
                tables_text += " | ".join([c.get_text().strip() for c in cols]) + "\n"
        
        # 2. Extract ALL Text with Hierarchy
        main_text = ""
        for element in soup.find_all(['h1', 'h2', 'h3', 'h4', 'h5', 'p', 'li', 'span']):
            # Filter out short menu items
            text = element.get_text().strip()
            if len(text) > 2:
                main_text += text + "\n"

        return main_text + "\n" + tables_text
    except Exception as e:
        print(f"Error scraping {url}: {e}")
        return ""

def main():
    RAW_BS_DIR = Path("data/raw_bs4")
    RAW_BS_DIR.mkdir(parents=True, exist_ok=True)
    
    all_extracted_data = {}

    for name, url in PAGES:
        content = extract_data(url)
        if content:
            (RAW_BS_DIR / f"{name}.txt").write_text(content, encoding="utf-8")
            all_extracted_data[name] = content
            time.sleep(1) # Be nice to the server

    print(f"DEEP-MINE COMPLETE! {len(all_extracted_data)} pages processed.")
    print("Data saved in data/raw_bs4/")

if __name__ == "__main__":
    main()
