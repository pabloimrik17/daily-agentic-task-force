// What the quota gate needs from whatever tracks the quota of the Claude accounts. It names
// no tool: each implementation keeps its own id inside its own module, and accounts are
// matched across tools by email address, the one value every tool shares.

// The windows the gate evaluates. Any other resource of an account is reported, not evaluated.
export const EVALUATED_WINDOWS = ["session", "weekly"] as const;

export type WindowName = (typeof EVALUATED_WINDOWS)[number];

export interface QuotaResource {
    unit: string;
    used?: number;
    available?: number;
    limit?: number;
    resetsAt?: string;
    windowSeconds?: number;
}

export interface QuotaAccount {
    id: string; // the quota source's own id, meaningful only to that source
    email: string | null; // null when the source carries none, so the account never matches
    displayName: string;
    plan: string | null;
    fetchedAt: string;
    expiresAt: string;
    stale: boolean;
    resources: Record<string, QuotaResource>;
}

type QuotaRead = { ok: true; accounts: QuotaAccount[] } | { ok: false; error: string };

// Every Claude account the source knows, or the reason it could not be read.
export interface QuotaSource {
    read(): Promise<QuotaRead>;
}
