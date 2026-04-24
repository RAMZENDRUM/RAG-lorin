import postgres from 'postgres';

export interface ShortTermMemory {
    role: 'user' | 'assistant';
    content: string;
    created_at?: string;
}

export interface UserProfile {
    user_id: string;
    name: string | null;
    interest: string | null;        // e.g. "CSE", "Hostel", "AI&DS"
    stage: 'exploring' | 'applied' | 'unknown';
    last_seen: Date;
}

// ── Fetch short-term + long-term memory in ONE round-trip each ──────────────
export async function fetchMemory(
    userId: string,
    db: ReturnType<typeof postgres>
): Promise<{ shortTerm: ShortTermMemory[]; profile: UserProfile }> {
    const [shortTermRows, profileRows] = await Promise.all([
        db<ShortTermMemory[]>`
            SELECT role, content, created_at
            FROM chat_history
            WHERE user_id = ${userId}
            ORDER BY created_at DESC
            LIMIT 10
        `.then(rows => rows.reverse()),
        db<UserProfile[]>`
            SELECT * FROM lorin_user_profiles WHERE user_id = ${userId} LIMIT 1
        `,
    ]);

    const profile: UserProfile = profileRows[0] ?? {
        user_id: userId,
        name: null,
        interest: null,
        stage: 'unknown',
        last_seen: new Date(),
    };

    return { shortTerm: shortTermRows, profile };
}

// ── Update long-term profile after each turn ─────────────────────────────────
export async function updateProfile(
    userId: string,
    updates: Partial<Pick<UserProfile, 'name' | 'interest' | 'stage'>>,
    db: ReturnType<typeof postgres>
): Promise<void> {
    await db`
        INSERT INTO lorin_user_profiles (user_id, name, interest, stage, last_seen)
        VALUES (${userId}, ${updates.name ?? null}, ${updates.interest ?? null}, ${updates.stage ?? 'unknown'}, NOW())
        ON CONFLICT (user_id) DO UPDATE SET
            name      = COALESCE(EXCLUDED.name, lorin_user_profiles.name),
            interest  = COALESCE(EXCLUDED.interest, lorin_user_profiles.interest),
            stage     = COALESCE(EXCLUDED.stage, lorin_user_profiles.stage),
            last_seen = NOW()
    `;
}

// ── Extract interest from query to update the profile ────────────────────────
export function extractInterest(text: string): string | null {
    const lower = text.toLowerCase();
    if (lower.includes('cse') || lower.includes('computer science')) return 'CSE';
    if (lower.includes('ai&ds') || lower.includes('data science')) return 'AI&DS';
    if (lower.includes('ai&ml') || lower.includes('machine learning')) return 'AI&ML';
    if (lower.includes('cyber')) return 'Cyber Security';
    if (lower.includes('csbs')) return 'CSBS';
    if (lower.includes('ece') || lower.includes('vlsi') || lower.includes('communication')) return 'ECE';
    if (lower.includes('eee') || lower.includes('electrical')) return 'EEE';
    if (lower.includes('mech')) return 'Mechanical';
    if (lower.includes('civil')) return 'Civil';
    if (lower.includes('it') || lower.includes('information tech')) return 'IT';
    if (lower.includes('hostel')) return 'Hostel';
    return null;
}
