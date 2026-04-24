import postgres from 'postgres';
import dotenv from 'dotenv';
dotenv.config();

let sql: any = null;

export interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
}

function getSql() {
    if (sql) return sql;
    if (!process.env.DATABASE_URL) {
        console.error('❌ DATABASE_URL is missing in Vercel environment variables!');
        return null;
    }
    sql = postgres(process.env.DATABASE_URL);
    return sql;
}

export async function getChatHistory(userId: number | string, limit: number = 10): Promise<ChatMessage[]> {
    try {
        const db = getSql();
        if (!db) return [];
        
        const safeUserId = BigInt(userId); // Force conversion for Supabase
        const history = await db`
            SELECT role, content 
            FROM chat_history 
            WHERE user_id = ${safeUserId}
            ORDER BY created_at DESC 
            LIMIT ${limit}
        `;
        return history.reverse().map((row: any) => ({
            role: row.role as 'user' | 'assistant',
            content: row.content
        }));
    } catch (err) {
        console.error('Failed to get chat history:', err);
        return [];
    }
}

export async function saveChatMessage(userId: number | string, role: 'user' | 'assistant', content: string, sessionId?: string) {
    try {
        const db = getSql();
        if (!db) return;
        
        const safeUserId = BigInt(userId);
        await db`
            INSERT INTO chat_history (user_id, role, content, session_id)
            VALUES (${safeUserId}, ${role}, ${content}, ${sessionId || null})
        `;
    } catch (err) {
        console.error('Failed to save chat message:', err);
    }
}

export async function clearChatHistory(userId: number) {
    try {
        const db = getSql();
        if (!db) return;
        await db`DELETE FROM chat_history WHERE user_id = ${userId}`;
    } catch (err) {
        console.error('Failed to clear chat history:', err);
    }
}
