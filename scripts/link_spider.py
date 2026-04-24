import requests
from bs4 import BeautifulSoup
from urllib.parse import urljoin, urlparse
import os

BASE_URL = "https://www.msajce-edu.in/"
visited = set()
to_visit = [BASE_URL]
discovered_links = []

print("Starting Link Discovery...")

if not os.path.exists("data"):
    os.makedirs("data")

while to_visit:
    url = to_visit.pop(0)
    if url in visited: continue
    visited.add(url)
    
    try:
        response = requests.get(url, timeout=15)
        soup = BeautifulSoup(response.text, 'html.parser')
        
        for a in soup.find_all('a', href=True):
            link = urljoin(BASE_URL, a['href'])
            parsed_link = urlparse(link)
            
            # Stay on domain
            if parsed_link.netloc == urlparse(BASE_URL).netloc:
                if any(link.endswith(ext) for ext in ['.php', '.html', '/']) or link == BASE_URL:
                    # Clean up query params if any
                    clean_link = link.split('?')[0].split('#')[0]
                    if clean_link not in visited and clean_link not in to_visit and clean_link.startswith(BASE_URL):
                        to_visit.append(clean_link)
                    if clean_link not in discovered_links and clean_link.startswith(BASE_URL):
                        discovered_links.append(clean_link)
                        print(f"Found: {clean_link}")
                        with open("data/master_links_live.txt", "a") as f:
                            f.write(clean_link + "\n")
    except Exception as e:
        print(f"Error at {url}: {e}")

with open("data/master_links.txt", "w") as f:
    for link in sorted(list(set(discovered_links))):
        f.write(link + "\n")

print(f"Discovery Complete. {len(discovered_links)} links saved to data/master_links.txt")
