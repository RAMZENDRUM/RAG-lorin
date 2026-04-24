import postgres from 'postgres';
import dotenv from 'dotenv';

dotenv.config();

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error('DATABASE_URL is missing!');

const sql = postgres(DATABASE_URL, { ssl: 'require' });

async function setupSupabaseRAG() {
    console.log('🚀 Setting up Supabase as Secondary RAG Engine...');

    try {
        // 1. Enable Vector Extensions
        await sql`CREATE EXTENSION IF NOT EXISTS vector;`;

        // 2. Create Knowledge Table
        await sql`
            CREATE TABLE IF NOT EXISTS lorin_knowledge (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                content TEXT NOT NULL,
                metadata JSONB,
                embedding VECTOR(1536),
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        `;

        // 3. Create HNSW Index for fast secondary search
        await sql`
            CREATE INDEX IF NOT EXISTS lorin_knowledge_embedding_idx 
            ON lorin_knowledge USING hnsw (embedding vector_cosine_ops);
        `;

        console.log('✅ Supabase "Secondary" Knowledge table created successfully.');
        console.log('Next: Run ingestion to sync Qdrant data to Supabase.');
    } catch (err: any) {
        console.error('❌ Supabase Setup Failed:', err.message);
    } finally {
        await sql.end();
    }
}

setupSupabaseRAG();
