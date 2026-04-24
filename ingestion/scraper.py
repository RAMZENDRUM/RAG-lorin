#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
MSAJCE Firecrawl RAG Pipeline
==========================================================
Uses Firecrawl SDK objects correctly.
"""

import asyncio
import os
import sys
import json
import time
import hashlib
import itertools
from pathlib import Path
from dotenv import load_dotenv
from openai import OpenAI
from firecrawl import FirecrawlApp

# ─── Load env ──────────────────────────────────────────────────────────────────
load_dotenv(dotenv_path=Path(__file__).parent.parent / ".env")

# ─── Configuration ─────────────────────────────────────────────────────────────
FIRECRAWL_API_KEY = "fc-faeb6fdb0b6b44468172a0f0c9c7d775"
VERCEL_GATEWAY_URL = "https://ai-gateway.vercel.sh/v1"

# Best model for refining
REFINE_MODEL = "openai/gpt-4o"
FALLBACK_MODEL = "openai/gpt-4o-mini"

VERCEL_KEYS = [
    os.getenv("VERCEL_AI_KEY"),
    os.getenv("VERCEL_AI_KEY_2"),
    os.getenv("VERCEL_AI_KEY_3"),
    os.getenv("VERCEL_AI_KEY_4"),
]
VERCEL_KEYS = [k for k in VERCEL_KEYS if k]
if not VERCEL_KEYS:
    print("❌ No Vercel AI keys found in .env")
    sys.exit(1)

_key_pool = itertools.cycle(enumerate(VERCEL_KEYS))

def get_next_client() -> tuple[int, OpenAI]:
    idx, key = next(_key_pool)
    return idx + 1, OpenAI(api_key=key, base_url=VERCEL_GATEWAY_URL)

# ─── Page URLs ─────────────────────────────────────────────────────────────────
PAGES = [
    ("index",                "https://www.msajce-edu.in/"),
    ("about",                "https://www.msajce-edu.in/about.php"),
    ("visionmission",        "https://www.msajce-edu.in/visionmission.php"),
    ("ourhistory",           "https://www.msajce-edu.in/ourhistory.php"),
    ("groupofinstitutions",  "https://www.msajce-edu.in/groupofinstitutions.php"),
    ("principal",            "https://www.msajce-edu.in/principal.php"),
    ("admission",            "https://www.msajce-edu.in/admission.php"),
    ("curriculm",            "https://www.msajce-edu.in/curriculm.php"),
    ("departments",          "https://www.msajce-edu.in/departments.php"),
    ("research",             "https://www.msajce-edu.in/research.php"),
    ("technologycentre",     "https://www.msajce-edu.in/technologycentre.php"),
    ("library",              "https://www.msajce-edu.in/library.php"),
    ("hostel",               "https://www.msajce-edu.in/hostel.php"),
    ("transport",            "https://www.msajce-edu.in/transport.php"),
    ("sports",               "https://www.msajce-edu.in/sports.php"),
    ("socialservices",       "https://www.msajce-edu.in/socialservices.php"),
    ("clubssocieties",       "https://www.msajce-edu.in/clubssocieties.php"),
    ("professionalsocities", "https://www.msajce-edu.in/professionalsocities.php"),
    ("alumni",               "https://www.msajce-edu.in/alumni.php"),
    ("Incubation&Startup",   "https://www.msajce-edu.in/Incubation&Startup.php"),
    ("civil",                "https://www.msajce-edu.in/civil.php"),
    ("cse",                  "https://www.msajce-edu.in/cse.php"),
    ("eee",                  "https://www.msajce-edu.in/eee.php"),
    ("ece",                  "https://www.msajce-edu.in/ece.php"),
    ("mech",                 "https://www.msajce-edu.in/mech.php"),
    ("it",                   "https://www.msajce-edu.in/it.php"),
    ("aids",                 "https://www.msajce-edu.in/aids.php"),
    ("csbs",                 "https://www.msajce-edu.in/csbs.php"),
    ("cyber",                "https://www.msajce-edu.in/cyber.php"),
    ("aiml",                 "https://www.msajce-edu.in/aiml.php"),
    ("ece-vlsi",             "https://www.msajce-edu.in/ece-vlsi.php"),
    ("ece-act",              "https://www.msajce-edu.in/ece-act.php"),
    ("sh",                   "https://www.msajce-edu.in/sh.php"),
]

# ─── Paths and Params ──────────────────────────────────────────────────────────
BASE_DIR       = Path(__file__).parent.parent
RAW_DIR        = BASE_DIR / "data" / "raw"
PROCESSED_DIR  = BASE_DIR / "data" / "processed"
UNIFIED_PATH   = BASE_DIR / "data" / "unified_cleaned_data.json"

CHUNK_SIZE = 500
OVERLAP    = 100

# ─── LLM Logic ─────────────────────────────────────────────────────────────────
SYSTEM_PROMPT = """You are an expert AI data refiner for the Mohamed Sathak A.J. College of Engineering (MSAJCE) RAG knowledge base.

STRICT INSTRUCTIONS:
1. CONTEXTUAL HEADER: Start with a clear ### header describing the page topic.
2. DATA RECONSTRUCTION: Convert all tables and contact details into readable sentences.
3. PRESERVE SPECIFICS: Keep phone numbers, emails, intake numbers (e.g. 60 seats), lab names, and faculty names EXACTLY as found.
4. PRESERVE MARKETING CLAIMS: Keep honors like "100+ IT Industries", "NBA", "NAAC A+" as bullet points.
5. CLEAN: Remove navigation, footers, and web boilerplate.
6. STRUCTURE: Use ### headers and bullet points.
7. COMPLETENESS: Do not summarize. Include all meaningful institutional data."""

def refine_with_llm(name: str, markdown: str, counters: dict) -> str:
    if not markdown.strip():
        return f"### {name.replace('-', ' ').title()}\n\n[No content extracted]"

    key_idx, client = get_next_client()
    counters['llm_calls'] += 1

    try:
        response = client.chat.completions.create(
            model=REFINE_MODEL,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user",   "content": f"PAGE: {name}\n\nRAW MARKDOWN:\n{markdown[:15000]}"},
            ],
            max_tokens=4000,
            temperature=0.1,
        )
        return response.choices[0].message.content.strip()
    except Exception as e:
        print(f"      ⚠️ Primary LLM failed for {name}: {e}. Trying fallback...")
        try:
            _, alt_client = get_next_client()
            response = alt_client.chat.completions.create(
                model=FALLBACK_MODEL,
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user",   "content": f"PAGE: {name}\n\nRAW MARKDOWN:\n{markdown[:15000]}"},
                ],
                max_tokens=4000,
                temperature=0.1,
            )
            return response.choices[0].message.content.strip()
        except Exception as e2:
            print(f"      ❌ Both LLMs failed. Saving raw markdown.")
            return markdown

def create_chunks(text: str, source: str, category: str, start_index: int) -> list[dict]:
    chunks = []
    prefix = f"[Topic: {category} | Origin: {source}]\n"
    start = 0
    idx = start_index
    while start < len(text):
        end   = start + CHUNK_SIZE
        chunk = text[start:end].strip()
        if chunk:
            content = prefix + chunk
            chunk_id = hashlib.md5(content.encode()).hexdigest()
            chunks.append({
                "index":    idx,
                "content":  content,
                "metadata": {
                    "source":    source,
                    "category":  category,
                    "id":        chunk_id,
                    "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                }
            })
            idx += 1
        start += (CHUNK_SIZE - OVERLAP)
    return chunks

# ─── Main Pipeline ─────────────────────────────────────────────────────────────
def main():
    print("🔥 Starting Firecrawl + LLM Refinement Pipeline...")
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    
    app = FirecrawlApp(api_key=FIRECRAWL_API_KEY)
    urls = [p[1] for p in PAGES]
    name_map = {p[1]: p[0] for p in PAGES}

    print(f"🕷️ Scraping {len(urls)} pages via Firecrawl...")
    job = app.batch_scrape(
        urls, 
        formats=["markdown", "html"],
        only_main_content=True
    )
    
    # Access as object properties
    if not job or not hasattr(job, 'data') or not job.data:
        print(f"❌ Error: Firecrawl batch scrape failed. Job object: {job}")
        sys.exit(1)

    print(f"✅ Scraped {len(job.data)} pages successfully.")

    all_chunks = []
    counters = {'llm_calls': 0}

    for i, doc in enumerate(job.data):
        # Access doc as object
        url      = doc.metadata.source_url if hasattr(doc.metadata, 'source_url') else doc.metadata.url
        name     = name_map.get(url, f"page_{i}")
        markdown = doc.markdown if doc.markdown else ""
        html     = doc.html if doc.html else ""

        print(f"[{i+1:02d}/{len(job.data)}] 📄 Processing: {name}")

        # Save Raw
        if html:
            (RAW_DIR / f"{name}.html").write_text(html, encoding="utf-8", errors="replace")
        if markdown:
            (RAW_DIR / f"{name}.txt").write_text(markdown, encoding="utf-8", errors="replace")

        # Refine
        refined_text = refine_with_llm(name, markdown, counters)
        (PROCESSED_DIR / f"{name}.hq.txt").write_text(refined_text, encoding="utf-8", errors="replace")
        (PROCESSED_DIR / f"{name}.processed.txt").write_text(refined_text, encoding="utf-8", errors="replace")

        # Chunk
        category = name.replace("-", " ").title()
        chunks   = create_chunks(refined_text, f"{name}.txt", category, len(all_chunks))
        all_chunks.extend(chunks)
        print(f"      📦 {len(chunks)} chunks created")

        time.sleep(0.5)

    UNIFIED_PATH.write_text(json.dumps(all_chunks, indent=2, ensure_ascii=False), encoding="utf-8")
    
    print("\n🌟 PIPELINE COMPLETE!")
    print(f"📊 Total Chunks: {len(all_chunks)}")
    print(f"📁 Unified data: data/unified_cleaned_data.json")
    print("\n🚀 Next: npx tsx scripts/ingest.ts")

if __name__ == "__main__":
    main()
