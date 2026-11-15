import type { OpenUsageLimits, OpenUsageProvider } from "./parse.ts";

export interface Account {
    key: string;
    displayName: string;
}

export type Selection =
    | {
          ok: true;
          key: string;
          provider: OpenUsageProvider;
          accounts: Account[];
      }
    | { ok: false; reason: string; accounts: Account[] };

// OpenUsage 0.8 keys every account `claude@<id>`; a bare `claude` key is still accepted.
function isClaudeKey(key: string): boolean {
    return key === "claude" || key.startsWith("claude@");
}

// Accounts come only from providers. OpenUsage 0.8 leaves out an account it has not fetched
// yet, and reports an account whose refreshes fail through `stale`, not through an error list.
export function selectAccount(limits: OpenUsageLimits, requested: string | undefined): Selection {
    const claude = Object.entries(limits.providers)
        .filter(([key]) => isClaudeKey(key))
        // Keys are unique, so no two compare equal.
        .sort(([a], [b]) => (a < b ? -1 : 1));
    const keys = claude.map(([key]) => key);
    const accounts = claude.map(([key, provider]) => ({
        key,
        displayName: provider.displayName,
    }));

    if (requested !== undefined && !keys.includes(requested)) {
        return { ok: false, reason: `unknown account "${requested}"`, accounts };
    }
    if (requested === undefined && keys.length > 1) {
        return {
            ok: false,
            reason: `ambiguous account: ${keys.length} Claude accounts present, pass --account <provider-key>`,
            accounts,
        };
    }
    const selected = claude.find(([key]) => key === (requested ?? keys[0]));
    if (selected === undefined) {
        return { ok: false, reason: "OpenUsage reported no Claude account", accounts };
    }

    const [key, provider] = selected;
    return { ok: true, key, provider, accounts };
}
