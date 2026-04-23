# 🤖 Lorin — AI Concierge for MSAJCE

> **A production-grade Retrieval-Augmented Generation (RAG) chatbot built for Mohamed Sathak A.J. College of Engineering (MSAJCE), Chennai.**
> Developed by **Ramanathan S (Ramzendrum)** — B.Tech IT, MSAJCE.

---

## What is Lorin?

Lorin is not a generic chatbot. She is a **sovereign AI assistant** trained exclusively on MSAJCE's institutional knowledge. She answers student queries about transport routes, admissions, departments, hostel, labs, and more — with **zero hallucinations** and a high-energy campus-buddy persona.

She is built on the **RAG (Retrieval-Augmented Generation)** architecture, which means:
- She does **not** make things up. Every answer is grounded in real documents.
- She can be updated instantly by adding new `.txt` files — no model retraining needed.
- She is **cheap to run** — most queries cost less than $0.0001.

---

## Architecture: The Hydra Pipeline

```
User Query
    │
    ▼
┌─────────────────────────────┐
│  Layer 1: SENTINEL (Instinct)│  ← Zero-cost hard-coded fast paths
│  (Tambaram, R 21, SIPCOT...) │    for critical transport & profile data
└────────────┬────────────────┘
             │ Miss
             ▼
┌─────────────────────────────┐
│  Layer 2: CACHE (Memory)    │  ← Identical queries served instantly
└────────────┬────────────────┘
             │ Miss
             ▼
┌─────────────────────────────┐
│  Layer 3: RAG BRAIN         │  ← Full pipeline:
│  Embed → Qdrant → Rerank    │    Embed (OpenAI) → Search (Qdrant)
│  → GPT-4o-mini → Answer     │    → Rerank (Cohere) → Generate (LLM)
└─────────────────────────────┘
```

---

## Tech Stack

| Layer | Technology | Purpose |
|:---|:---|:---|
| **LLM** | OpenAI `gpt-4o-mini` | Answer generation |
| **Embeddings** | `text-embedding-3-small` (1536 dims) | Semantic search |
| **Vector DB** | Qdrant (Cloud) | Knowledge retrieval |
| **Reranker** | Cohere `rerank-english-v3.0` | Precision filtering |
| **Bot Interface** | Telegraf (Telegram) | Student-facing UI |
| **Deployment** | Vercel (Serverless Webhook) | 24/7 hosting |
| **Reporting** | Nodemailer + Brevo SMTP | Weekly email reports |
| **Ingestion** | TSX + 4-Key Rotation | Parallel data processing |

---

## Knowledge Base

Lorin currently has **34 raw data files** covering:

| Category | Files |
|:---|:---|
| **Transport** | `transport_and_profile.txt`, `transport.txt` |
| **Admissions** | `admission.txt` |
| **Departments** | `it.txt`, `cse.txt`, `aids.txt`, `aiml.txt`, `ece.txt`, `eee.txt`, `mech.txt`, `civil.txt`, `cyber.txt`, `csbs.txt`, `ece-vlsi.txt`, `ece-act.txt` |
| **Campus Life** | `hostel.txt`, `sports.txt`, `library.txt`, `clubssocieties.txt` |
| **Institutional** | `about.txt`, `visionmission.txt`, `principal.txt`, `ourhistory.txt`, `departments.txt` |
| **Research & Innovation** | `research.txt`, `technologycentre.txt`, `Incubation&Startup.txt` |
| **Community** | `alumni.txt`, `socialservices.txt`, `professionalsocities.txt` |

---

## Key Features

### 🛡️ Zero-Hallucination Sentinel System
Hard-coded fast-paths for the most critical, volatile data:
- **R 21** (formerly AR 10): Full route from Porur → MSAJCE
- **Tambaram, Pallikaranai, Medavakkam, Velachery, SIPCOT** arrival times
- **Principal:** Dr. K. S. Srinivasan
- **Developer Profile:** Ramanathan S (Ramzendrum)

### 🚌 100% Transport Fidelity
- All bus routes (AR3–AR9, N/3, R21, R22) with **stop-by-stop timings**
- SIPCOT arrival locked at **07:45–07:55 AM**
- **Kaiveli** correctly spelled (not "Kiveli")
- Ladies Hostel = Girls Hostel at **Sholinganallur** stop

### 🧠 Smart Ingestion Pipeline
- **MD5 Hashing** for deterministic point IDs (no duplicates in Qdrant)
- **4-Key Rotation** across Vercel AI Gateway for parallel processing
- **Burst-and-Rest** strategy: 5 requests burst → 0.5s gap → 30s rest

### 📊 Weekly Intelligence Reports (Every Sunday)
Three auto-generated CSV reports sent to `ramzendrum@gmail.com`:
1. **`lorin_audit_forensics.csv`** — UserID, SessionID, Latency, Cost, Spam/Abuse Flags
2. **`lorin_developer_optimization.csv`** — Unanswered queries, Match scores, Missed keywords
3. **`lorin_institutional_benefits.csv`** — Trend Detection, Cost Savings, Knowledge Coverage

### 🔒 Security & Rate Limiting
- **Spam Detection:** 5 identical messages → 1 hour suspension
- **Rate Limit:** 5 msg/min, 25 msg/day per user
- **Permanent Ban:** Rapid-fire spammers auto-blocked

---

## Getting Started

### Prerequisites
- Node.js 18+
- Qdrant Cloud account
- OpenAI + Cohere API keys
- Telegram Bot Token (from @BotFather)
- Brevo SMTP account (for weekly reports)

### Installation

```bash
git clone https://github.com/RAMZENDRUM/RAG-lorin.git
cd RAG-lorin
npm install
```

### Environment Setup
Create a `.env` file (see `.env.production` for the full list of required keys):

```env
VERCEL_AI_KEY=your_key
QDRANT_URL=your_qdrant_url
QDRANT_API_KEY=your_qdrant_key
COHERE_API_KEY=your_cohere_key
TELEGRAM_BOT_TOKEN=your_bot_token
BREVO_SMTP_LOGIN=your_brevo_login
BREVO_SMTP_KEY=your_brevo_smtp_key
```

### Running the Pipeline

```bash
# Step 1: Ingest data into Qdrant
npm run ingest

# Step 2: Run the bot locally
npm run bot

# Step 3: Generate weekly report manually
npx tsx scripts/generate-weekly-report.ts
```

---

## Deployment (Vercel — 24/7 Free)

1. Push to GitHub (already configured)
2. Import repo into [vercel.com](https://vercel.com)
3. Add all environment variables in Vercel Dashboard
4. After deploy, register the webhook **once**:

```
https://api.telegram.org/bot<YOUR_TOKEN>/setWebhook?url=https://rag-lorin.vercel.app/api/bot
```

---

## Developer

**Ramanathan S** — *Creator & Architect*
- 🎓 B.Tech Information Technology, MSAJCE (2nd Year)
- 💼 [LinkedIn](https://www.linkedin.com/in/ramanathan-s-it)
- 🌐 [Portfolio](https://ramanathan-portfolio.vercel.app)

---

## License
MIT — Built with purpose for MSAJCE students.
