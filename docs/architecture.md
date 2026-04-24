# Lorin RAG: System Design & Architecture

This document describes the high-level design of the Lorin RAG assistant, focusing on the processing pipeline and data flow.

## 1. The 9-Stage Orchestration Pipeline
Lorin uses a modular orchestrator logic to process every user message through nine distinct stages to ensure groundedness and precision.

1.  **Ingestion & Refinement**: Batch scraping via Firecrawl followed by LLM-based cleaning to ensure high SNR (Signal-to-Noise Ratio).
2.  **Intent Classification**: Mapping user queries to categories (e.g., Admissions, Transport, Faculty).
3.  **Query Rewriting**: Expanding vague user tokens (e.g., "Tell me more about him") into rich, context-contained search queries.
4.  **Matryoshka Embedding**: Generating 1536-dimensional vectors optimized for prefix-slicing and semantic retrieval.
5.  **Multi-Index Retrieval**: Parallel querying across Qdrant and Supabase.
6.  **Context Reranking**: Using a lightweight LLM pass (GPT-4o-mini) to sort retrieved chunks by relevance before passing to the final model.
7.  **Dynamic Prompt Construction**: Assembling profile data, conversation history, and grounded data chunks.
8.  **Grounded Generation**: Response generation with strict "Don't Hallucinate" instructions.
9.  **Post-Processing**: Injecting dynamic forms (Google Forms) or location links based on intent.

## 2. Technical Decisions & Rationale

### OpenAI Embeddings (1536 Dim)
We standardized on `text-embedding-3-small`. The choice of 1536 dimensions allows for high-granularity search in institutional datasets where subtle differences (e.g., different engineering departments) are critical.

### Hybrid Retrieval Strategy
We use Qdrant as the primary vector store for its low latency and payload filtering capabilities. Supabase serves as our secondary index and relational storage, providing a fallback and robust ACID-compliant user memory.

### Agentic Orchestration
Instead of a simple chain, we use an orchestrator that can decide when to ask clarifying questions or when to trigger "Marketing Mode" to handle competitive institutional claims.

## 3. Data Integrity & Evaluation
We integrate the **Ragas** framework to evaluate:
- **Faithfulness**: Is the answer derived solely from the context?
- **Answer Relevance**: Does it directly address the user's intent?
- **Context Precision**: Did we retrieve exactly what was needed?

---
*Architectural Design by Lorin Engineering*
