import os
import re

UNIFIED_DIR = "data/02_unified"
MASTER_DIR = "data/03_master"

if not os.path.exists(MASTER_DIR):
    os.makedirs(MASTER_DIR)

def humanize_file(filename):
    with open(os.path.join(UNIFIED_DIR, filename), "r", encoding="utf-8") as f:
        lines = f.readlines()

    clean_content = []
    current_table = []
    headers = []
    
    # Skip the typical 100-line navigation header found in these scrapes
    main_start = 0
    for i, line in enumerate(lines):
        if "About Us" in line and "Vision and Mission" in lines[min(i+5, len(lines)-1)]:
            main_start = i + 50 # Skip past the menu
            break
            
    content_lines = lines[main_start:]
    
    i = 0
    while i < len(content_lines):
        line = content_lines[i].strip()
        
        # Detect Table Header Start
        if "S.No" in line or "Name" in line and "Designation" in str(content_lines[min(i+5, len(content_lines)-1)]):
            # Extract headers
            headers = []
            while i < len(content_lines) and not content_lines[i].strip().isdigit():
                h = content_lines[i].strip()
                if h and h != "S.No" and len(h) < 50:
                    headers.append(h)
                i += 1
            
            # Extract Rows
            while i < len(content_lines):
                if content_lines[i].strip().isdigit():
                    row_id = content_lines[i].strip()
                    i += 1
                    row_data = []
                    # Pull next N lines based on header count
                    for _ in range(len(headers)):
                        if i < len(content_lines):
                            row_data.append(content_lines[i].strip())
                            i += 1
                    
                    # Construct meaningful sentence
                    if row_data:
                        sentence = f"Information for {row_data[0] if row_data else 'Entry'}: "
                        for h, val in zip(headers, row_data):
                            if val and val.lower() not in ["view", "download", "view details"]:
                                sentence += f"The {h} is {val}. "
                        clean_content.append(sentence)
                else:
                    break
        
        # Keep Narrative Text
        elif len(line) > 30 and not line.startswith("URL:") and not line.startswith("[["):
            # Clean common artifacts
            line = re.sub(r'Â| ', ' ', line)
            line = re.sub(r'\s+', ' ', line)
            clean_content.append(line)
            i += 1
        else:
            i += 1

    # Save to Master
    master_name = filename.replace(".unified.txt", ".master.txt")
    with open(os.path.join(MASTER_DIR, master_name), "w", encoding="utf-8") as f:
        f.write("\n".join(clean_content))
    print(f"Humanized: {master_name}")

# Process all files
for file in os.listdir(UNIFIED_DIR):
    if file.endswith(".unified.txt"):
        try:
            humanize_file(file)
        except Exception as e:
            print(f"Failed to process {file}: {e}")
