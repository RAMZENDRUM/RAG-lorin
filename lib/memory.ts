import postgres from 'postgres';
import dotenv from 'dotenv';

dotenv.config();

const sql = postgres(process.env.DATABASE_URL!);

export interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
}

export async function getChatHistory(userId: number, limit: number = 10): Promise<ChatMessage[]> {
    try {
        const history = await sql`
            SELECT role, content 
            FROM chat_history 
            WHERE user_id = ${userId}
            ORDER BY created_at DESC 
            LIMIT ${limit}
        `;
        
        // Return in chronological order
        return history.reverse().map(row => ({
            role: row.role as 'user' | 'assistant',
            content: row.content
        }));
    } catch (err) {
        console.error('Failed to get chat history:', err);
        return [];
    }
}

export async function saveChatMessage(userId: number, role: 'user' | 'assistant', content: string, sessionId?: string) {
    try {
        await sql`
            INSERT INTO chat_history (user_id, role, content, session_id)
            VALUES (${userId}, ${role}, ${content}, ${sessionId || null})
        `;
    } catch (err) {
        console.error('Failed to save chat message:', err);
    }
}

export async function clearChatHistory(userId: number) {
    try {
        await sql`DELETE FROM chat_history WHERE user_id = ${userId}`;
    } catch (err) {
        console.error('Failed to clear chat history:', err);
    }
}
