import { CLI_TIMEOUT_MS, execCommand, type Exec } from "../exec.ts";
import { type OpenUsageLimits, type OpenUsageProvider, parseLimits } from "./parse.ts";
import type { QuotaAccount, QuotaSource } from "./source.ts";

export type OpenUsageExec = Exec;

export type ReadResult = { ok: true; limits: OpenUsageLimits } | { ok: false; error: string };

// The output of a non-zero exit is kept only for its exit code, which the reason names.
export const execOpenUsage: OpenUsageExec = execCommand("openusage", CLI_TIMEOUT_MS, {
    keepOutputOnExit: true,
});

function parseOutput(stdout: string): ReadResult {
    let json: unknown;
    try {
        json = JSON.parse(stdout);
    } catch (error) {
        return {
            ok: false,
            error: `openusage output is not valid JSON: ${(error as Error).message}`,
        };
    }
    const parsed = parseLimits(json);
    return parsed.ok ? { ok: true, limits: parsed.value } : { ok: false, error: parsed.error };
}

// OpenUsage 0.8 prints what its app last fetched and never refreshes, so `--force` is never
// passed: 0.8 ignores it. No non-zero exit carries an account error (design D2): exit 2 is a
// bad argument or no Claude account, and exit 4 is nothing fetched yet, whose document lists no
// Claude account. So the output of a non-zero exit is not read, and the CLI failure is the reason.
export async function readOpenUsage(exec: OpenUsageExec): Promise<ReadResult> {
    const result = await exec(["claude"]);
    if (result.ok) {
        return parseOutput(result.stdout);
    }
    return {
        ok: false,
        error: result.exit ? `${result.error} (exit ${result.exit.code})` : result.error,
    };
}

// OpenUsage 0.8 keys every account `claude@<id>`; a bare `claude` key is still accepted.
function isClaudeKey(key: string): boolean {
    return key === "claude" || key.startsWith("claude@");
}

// OpenUsage has no email field: it names an account `Claude · <email>`. The text after the last
// separator is the email address, and only when it looks like one.
function emailOf(displayName: string): string | null {
    const separator = displayName.lastIndexOf("·");
    if (separator === -1) return null;
    const email = displayName.slice(separator + 1).trim();
    return email.includes("@") ? email : null;
}

function toAccount(id: string, provider: OpenUsageProvider): QuotaAccount {
    const { displayName, plan, fetchedAt, expiresAt, stale, resources } = provider;
    return {
        id,
        email: emailOf(displayName),
        displayName,
        plan: plan ?? null,
        fetchedAt,
        expiresAt,
        stale,
        resources,
    };
}

// Accounts come only from providers. OpenUsage 0.8 leaves out an account it has not fetched
// yet, and reports an account whose refreshes fail through `stale`, not through an error list.
export function openUsageSource(exec: OpenUsageExec): QuotaSource {
    return {
        async read() {
            const read = await readOpenUsage(exec);
            if (!read.ok) return read;
            const accounts = Object.entries(read.limits.providers)
                .filter(([key]) => isClaudeKey(key))
                // Keys are unique, so no two compare equal.
                .sort(([a], [b]) => (a < b ? -1 : 1))
                .map(([key, provider]) => toAccount(key, provider));
            return { ok: true, accounts };
        },
    };
}
