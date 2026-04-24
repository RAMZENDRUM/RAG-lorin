# 🤖 Lorin: Production-Grade Multi-Stage RAG Assistant

Lorin is a high-fidelity Retrieval-Augmented Generation (RAG) system designed to serve as an intelligent digital concierge for institutional knowledge. Unlike basic "Chat-with-PDF" wrappers, Lorin implements a **9-stage intelligence pipeline** featuring multi-stage query understanding, hybrid retrieval, and long-term memory.

---

## 🎯 System Overview
Lorin transforms fragmented institutional data (web pages, PDFs, internal docs) into a conversational interface used by students and parents. It optimizes for **factuality, low-latency, and context-awareness** in real-world scenarios.

### 🚀 Key Capabilities
*   **Multi-Stage Query Pipeline**: Utilizes an Orchestrator layer for intent classification, query rewriting, and LLM-based reranking.
*   **Hybrid Retrieval Layer**: Dual-search strategy using **Qdrant** (high-speed vector search) and **Supabase/pgvector** (secondary filtered search).
*   **Long-Term Memory**: Persistent user profiling and conversation history management for cohesive multi-turn dialogues.
*   **Production Ingestion**: A robust ETL pipeline using the **Firecrawl SDK** for clean batch extraction and GPT-4o for institutional data refinement.
*   **Audit Logging**: Native support for performance monitoring and diagnostic audits.

---

## 🏗️ Architecture
The system is built on a modular four-layer architecture:

1.  **Interface Layer (Telegram)**: Managed by Telegraf/GrammY with built-in rate-limiting and toxicity protection.
2.  **Intelligence Layer (Orchestrator)**: Handles Query Rewriting (expanding vague questions) and Intent Mapping.
3.  **Retrieval Layer (Hybrid)**: Vector search at **1536 dimensions** using `text-embedding-3-small`.
4.  **Memory Layer (Persistence)**: Relational Postgres storage for persistent user profiles and interest extraction.

---

## 🛠️ Tech Stack
*   **LLM Framework**: Vercel AI SDK
*   **Embeddings**: OpenAI (1536-dim Matryoshka-compatible)
*   **Databases**: Qdrant (Vector) & Supabase (Postgres/Vector)
*   **Scraping**: Firecrawl SDK
*   **Compute**: Node.js & TypeScript / Python (Analytics)

---

## 🔄 System Flow
```text
User  →  Telegram Bot  →  Orchestrator (Intent → Rewrite → Rerank)
                               ↓
          Memory (Postgres) ← Retriever (Qdrant + Supabase)
                               ↓
                        Grounded Response Generator
```

---

## 💻 Developer Setup

### 1. Requirements
* Node.js v20+
* Docker (for Qdrant) or Cloud API keys

### 2. Environment Configuration
Clone `.env.example` to `.env` and provide your secrets:
```bash
cp .env.example .env
```

### 3. Usage
* **Ingest Data**: `npm run ingest`
* **Evaluate**: `npm run eval`
* **Launch Bot**: `npm run bot`

---

## 📍 Potential Use Cases
*   **Admissions**: Guiding parents through eligibility and fee structures.
*   **HR/Ops**: Providing internal policy info to staff.
*   **Student Support**: Quick access to bus routes, schedules, and department head details.

---
**Developed by [Ramanathan S](https://linkedin.com/in/ramanathan-s-it)**
