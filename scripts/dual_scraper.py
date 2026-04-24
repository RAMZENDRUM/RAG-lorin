import requests
from bs4 import BeautifulSoup
import trafilatura
import os
import json
import time

LINKS_FILE = "data/master_links_live.txt"
BS4_DIR = "data/dual_scrape/bs4"
TRAF_DIR = "data/dual_scrape/trafilatura"
UNIFIED_DIR = "data/dual_scrape/unified"

def clean_filename(url):
    return url.split("/")[-1].replace(".php", "").replace(".html", "") or "index"

def scrape_bs4(url):
    try:
        response = requests.get(url, timeout=15)
        soup = BeautifulSoup(response.text, 'html.parser')
        
        # Remove script and style elements
        for script in soup(["script", "style"]):
            script.extract()

        # Get text with better formatting
        lines = (line.strip() for line in soup.get_text().splitlines())
        chunks = (phrase.strip() for line in lines for phrase in line.split("  "))
        text = '\n'.join(chunk for chunk in chunks if chunk)
        
        # Specifically get tables
        tables = soup.find_all('table')
        table_data = ""
        for i, table in enumerate(tables):
            table_data += f"\n--- TABLE {i+1} ---\n"
            for row in table.find_all('tr'):
                cells = [cell.get_text().strip() for cell in row.find_all(['td', 'th'])]
                table_data += " | ".join(cells) + "\n"
        
        return f"URL: {url}\n\nSTRUCTURED TEXT:\n{text}\n\nTABLE DATA:\n{table_data}"
    except Exception as e:
        return f"BS4 Error: {e}"

def scrape_trafilatura(url):
    try:
        downloaded = trafilatura.fetch_url(url)
        content = trafilatura.extract(downloaded, include_tables=True, include_links=True, output_format='markdown')
        return f"URL: {url}\n\nMARKDOWN CONTENT:\n{content}"
    except Exception as e:
        return f"Trafilatura Error: {e}"

def main():
    if not os.path.exists(LINKS_FILE):
        print(f"Error: {LINKS_FILE} not found.")
        return

    with open(LINKS_FILE, "r") as f:
        links = [l.strip() for l in f.readlines() if l.strip()]

    print(f"Starting Dual Scrape for {len(links)} links...")

    for url in links:
        fname = clean_filename(url)
        print(f"Scraping: {url} -> {fname}")
        
        # Method 1
        bs4_data = scrape_bs4(url)
        with open(f"{BS4_DIR}/{fname}.txt", "w", encoding="utf-8") as f:
            f.write(bs4_data)
            
        # Method 2
        traf_data = scrape_trafilatura(url)
        with open(f"{TRAF_DIR}/{fname}.md", "w", encoding="utf-8") as f:
            f.write(traf_data if traf_data else "No content extracted.")
            
        # Simple Merge (Initial version - deduplicating by combining and letting the RAG handle context)
        unified_content = f"--- SOURCE: {url} ---\n\n"
        unified_content += "[[ STRUCTURED DATA (BS4) ]]\n"
        unified_content += bs4_data + "\n\n"
        unified_content += "[[ NARRATIVE DATA (TRAFILATURA) ]]\n"
        unified_content += (traf_data if traf_data else "[No narrative content]")
        
        with open(f"{UNIFIED_DIR}/{fname}.unified.txt", "w", encoding="utf-8") as f:
            f.write(unified_content)
        
        time.sleep(1) # Polite scraping

    print("Dual Scrape Complete.")

if __name__ == "__main__":
    main()
