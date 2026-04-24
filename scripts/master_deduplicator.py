import os
import re

UNIFIED_DIR = "data/dual_scrape/unified"
MASTER_DIR = "data/dual_scrape/master"

if not os.path.exists(MASTER_DIR):
    os.makedirs(MASTER_DIR)

def deduplicate_text(text):
    # Split by lines and remove empty ones
    lines = [line.strip() for line in text.split('\n') if line.strip()]
    
    # Simple deduplication: keep track of seen lines
    seen = set()
    unique_lines = []
    for line in lines:
        # Normalize for comparison
        norm = re.sub(r'\s+', ' ', line).lower()
        if norm not in seen:
            unique_lines.append(line)
            seen.add(norm)
    
    return '\n'.join(unique_lines)

def process_unified():
    files = [f for f in os.listdir(UNIFIED_DIR) if f.endswith(".unified.txt")]
    print(f"Deduplicating {len(files)} files...")
    
    for fname in files:
        with open(os.path.join(UNIFIED_DIR, fname), "r", encoding="utf-8") as f:
            content = f.read()
            
        # Clean up the unified content
        # We want to keep the structure but remove literal double-pasted paragraphs
        cleaned = deduplicate_text(content)
        
        master_name = fname.replace(".unified.txt", ".master.txt")
        with open(os.path.join(MASTER_DIR, master_name), "w", encoding="utf-8") as f:
            f.write(cleaned)
        print(f"Processed: {master_name}")

if __name__ == "__main__":
    process_unified()
