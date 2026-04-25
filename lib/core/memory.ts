import postgres from 'postgres';

export interface ShortTermMemory {
    role: 'user' | 'assistant';
    content: string;
    created_at?: string;
}

export interface UserProfile {
    user_id: string;
    name: string | null;
    interest: string | null;
    stage: 'exploring' | 'applied' | 'unknown';
    last_seen: Date;
    strikes: number;
    blocked_until: Date | null;
}

// ── Fetch Memory (Unified with correctly named tables) ────────────────────────
export async function fetchMemory(
    userId: string,
    db: any
): Promise<{ shortTerm: ShortTermMemory[]; profile: UserProfile }> {
    try {
        if (!db) throw new Error("Database not connected");

        const [shortTermRows, profileRows] = await Promise.all([
            db<ShortTermMemory[]>`
                SELECT role, content, created_at
                FROM chat_history
                WHERE user_id = ${userId}
                ORDER BY created_at DESC
                LIMIT 15
            `.then(rows => rows.reverse()),
            db<UserProfile[]>`
                SELECT * FROM user_profiles WHERE user_id = ${userId} LIMIT 1
            `,
        ]);

        const profile: UserProfile = profileRows[0] ?? {
            user_id: userId,
            name: null,
            interest: null,
            stage: 'unknown',
            last_seen: new Date(),
            strikes: 0,
            blocked_until: null,
        };

        return { shortTerm: shortTermRows || [], profile };
    } catch (e: any) {
        console.error('Memory Fetch Error:', e.message);
        // Return skeleton to prevent total crash
        return { 
            shortTerm: [], 
            profile: { user_id: userId, name: null, interest: null, stage: 'unknown', last_seen: new Date(), strikes: 0, blocked_until: null } 
        };
    }
}

// ── Update Profile ─────────────────────────────────────────────────────────
export async function updateProfile(
    userId: string,
    updates: Partial<UserProfile>,
    db: any
): Promise<void> {
    try {
        if (!db) return; // Silent skip if no DB
        await db`
            INSERT INTO user_profiles (user_id, name, interest, stage, last_seen, strikes, blocked_until)
            VALUES (${userId}, ${updates.name ?? null}, ${updates.interest ?? null}, ${updates.stage ?? 'unknown'}, NOW(), ${updates.strikes ?? 0}, ${updates.blocked_until ?? null})
            ON CONFLICT (user_id) DO UPDATE SET
                name      = COALESCE(EXCLUDED.name, user_profiles.name),
                interest  = COALESCE(EXCLUDED.interest, user_profiles.interest),
                stage     = COALESCE(EXCLUDED.stage, user_profiles.stage),
                strikes   = COALESCE(EXCLUDED.strikes, user_profiles.strikes),
                blocked_until = COALESCE(EXCLUDED.blocked_until, user_profiles.blocked_until),
                last_seen = NOW()
        `;
    } catch (e: any) {
        console.error('Profile Update Error:', e.message);
    }
}

// ── Interest Extraction ──────────────────────────────────────────────────────
export function extractInterest(text: string): string | null {
    const lower = text.toLowerCase();
    if (lower.includes('cse') || lower.includes('computer science')) return 'CSE';
    if (lower.includes('ai&ds') || lower.includes('data science')) return 'AI&DS';
    if (lower.includes('it') || lower.includes('information')) return 'IT';
    if (lower.includes('ece')) return 'ECE';
    if (lower.includes('mech')) return 'Mechanical';
    if (lower.includes('civil')) return 'Civil';
    if (lower.includes('hostel')) return 'Hostel';
    if (lower.includes('fee')) return 'Fees';
    if (lower.includes('placement')) return 'Placement';
    return null;
}
