# Lorin: The 9-Stage Orchestrated RAG Assistant 🦾🎓

**Lorin** is a production-grade, high-fidelity RAG (Retrieval-Augmented Generation) system designed as a digital concierge for Mohamed Sathak A.J. College of Engineering (MSAJCE). Unlike standard RAG implementations, Lorin utilizes a specialized **9-stage orchestration pipeline** to handle complex, vague, and context-dependent queries from students and parents.

---

## 🚀 Key Features

- **9-Stage Orchestration**: A sophisticated pipeline that moves from Intent Classification to Query Rewriting, Hybrid Retrieval, and Reranking before generating a response.
- **Dual-Fidelity Knowledge Mining**: A custom ingestion engine combining Structural (BeautifulSoup) and Narrative (Trafilatura) scraping to ensure 100% data parity for complex tables and administrative roles.
- **Hybrid Retrieval Engine**: Seamlessly blends Qdrant Vector search (semantic) with Supabase pgvector/keyword matching for precise entity resolution.
- **Parallel Multi-Engine Sync**: A high-speed ingestion pipeline that utilizes parallel workers across multiple LLM providers (OpenRouter + Vercel) to maintain zero-latency knowledge updates.
- **Auto-Grounding & Source Trust**: Every response is grounded in verified metadata, automatically injecting source-linked URLs (e.g., official department pages) into the final reply.

---

## 🏗️ System Architecture

Lorin is built on a **Modular Multi-Layer Architecture**:

### 1. Intelligence Layer (`lib/core/orchestrator.ts`)
The "Brain" of the system. It doesn't just "search"—it reasons. It classifies the user's intent (Admin, Placement, Faculty), rewrites vague queries (e.g., "Tell me more about him"), and reranks retrieved chunks to minimize LLM hallucinations.

### 2. Retrieval Layer (`lib/core/retrieve.ts`)
A dual-engine system using **Qdrant** for high-speed semantic search and **Supabase** for keyword-heavy institutional lookups.

### 3. Interface Layer (`bot/` & `api/`)
A multi-modal interface deployed via **Telegram** and hosted on **Vercel Edge Functions** for 24/7 global availability and near-zero cold starts.

---

## 🛠️ Tech Stack

- **Model Engine**: GPT-4o-mini (Orchestration) + text-embedding-3-small (1536 dim)
- **Vector Store**: Qdrant Cloud (Primary)
- **Database**: Supabase / PostgreSQL (Hybrid Search & Long-Term Memory)
- **Framework**: Vercel AI SDK, Telegraf (Telegram)
- **Data Ingestion**: Playwright, BeautifulSoup, Trafilatura
- **Deployment**: Vercel Serverless

---

## 🌊 System Flow

1. **User Query** → Received via Telegram Bot.
2. **Intent Classification** → Orchestrator identifies if the user is asking about admissions, fees, or leadership.
3. **Query Expansion** → Resolves pronouns (e.g., "who is he?") based on conversation history.
4. **Hybrid Search** → Simultaneous pull from Qdrant and Supabase.
5. **Reranking** → Scores retrieved data for factual relevance.
6. **Grounded Response** → Generates an answer strictly using the master knowledge base with source-link injection.

---

## 💻 Developer Setup

```bash
# 1. Clone the repo
git clone https://github.com/yourusername/RAG-lorin.git

# 2. Install dependencies
npm install

# 3. Environment Setup
cp .env.example .env
# Update with your Qdrant, Supabase, and OpenAI credentials

# 4. Ingest Master Knowledge
npx tsx ingestion/ingest.ts

# 5. Run Locally
npm run dev
```

---

## 🌟 Use Cases
- **Institutional Onboarding**: Helping prospective parents understand cutoff marks and fee structures.
- **Administrative Automation**: Providing instant contact details for HODs and administrative officers.
- **Placement Intelligence**: Giving students instant access to company-wise recruitment history and job statistics.

---

### 👨‍💻 Developer
**Ramanathan S** (B.Tech IT, MSAJCE)  
[LinkedIn](https://www.linkedin.com/in/ramanathan-s-it) | [Portfolio](https://ramanathan-portfolio.vercel.app)
