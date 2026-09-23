import type { OpenUsageLimits, OpenUsageProvider } from "./parse.ts";

export interface Candidate {
    key: string;
    displayName: string | null;
}

export type Selection =
    | {
          ok: true;
          key: string;
          provider: OpenUsageProvider | undefined;
          errors: string[];
          candidates: Candidate[];
      }
    | { ok: false; reason: string; candidates: Candidate[] };

function isClaudeKey(key: string): boolean {
    return key === "claude" || key.startsWith("claude@");
}

// Accounts come from providers and from errors: an account whose refresh failed
// may appear only in `errors`, and must still be selectable so the failure is reported.
export function selectAccount(limits: OpenUsageLimits, requested: string | undefined): Selection {
    const keys = [
        ...new Set([...Object.keys(limits.providers), ...limits.errors.map((e) => e.providerId)]),
    ]
        .filter(isClaudeKey)
        .sort();
    const candidates = keys.map((key) => ({
        key,
        displayName: limits.providers[key]?.displayName ?? null,
    }));

    if (requested !== undefined && !keys.includes(requested)) {
        return { ok: false, reason: `unknown account "${requested}"`, candidates };
    }
    if (requested === undefined && keys.length > 1) {
        return {
            ok: false,
            reason: `ambiguous account: ${keys.length} Claude accounts present, pass --account <provider-key>`,
            candidates,
        };
    }
    const key = requested ?? keys[0];
    if (key === undefined) {
        return { ok: false, reason: "OpenUsage reported no Claude account", candidates };
    }

    return {
        ok: true,
        key,
        provider: limits.providers[key],
        errors: limits.errors.filter((e) => e.providerId === key).map((e) => e.message),
        candidates,
    };
}
