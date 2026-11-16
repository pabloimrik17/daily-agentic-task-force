import type { StepResult } from "../runner.ts";
import type { OtherResource, WindowReport } from "./decide.ts";
import type { Projection } from "./project.ts";
import type { Account } from "./select.ts";
import type { CapacityAccount, QuotaGateData } from "./step.ts";

const PROJECTION_REASONS: Record<Extract<Projection, { available: false }>["reason"], string> = {
    "non-positive-limit": "limit is not positive",
    "non-positive-window": "window duration is not positive",
    "no-consumption": "no consumption yet",
    "window-expired": "window already reset",
    "insufficient-elapsed": "too early in the window",
};

export function renderQuotaGate(result: StepResult<QuotaGateData>): string {
    const { account, accounts, windows, otherResources, accountsWithCapacity = [] } = result.data;
    const lines = [`[${result.step}] ${result.outcome} (${result.tier})`];

    if (account) {
        lines.push(`  account   ${describe(account, [account.plan])}`);
        if (account.fetchedAt) {
            lines.push(
                `  fetched   ${account.fetchedAt}${account.stale ? "  [STALE — values below are last known]" : ""}`,
            );
        }
    }
    for (const w of windows) {
        lines.push(`  ${w.name.padEnd(9)} ${renderWindow(w)}`);
    }
    for (const r of otherResources) {
        lines.push(`  ${r.name.padEnd(9)} ${current(r)}  not evaluated`);
    }
    if (!account && accounts.length > 0) {
        lines.push("  accounts:", ...accounts.map((a) => `    - ${describe(a)}`));
    }
    if (accountsWithCapacity.length > 0) {
        lines.push(
            "  capacity elsewhere (Claude Code is not logged in as these):",
            ...accountsWithCapacity.map((a) => `    - ${elsewhere(a)}`),
        );
    }
    lines.push("  reasons:", ...result.reasons.map((r) => `    - ${r}`));
    return lines.join("\n");
}

// The email address leads, since it is how the account is known outside the quota source.
function describe(account: Account, extra: (string | null)[] = []): string {
    const name = [account.displayName, ...extra].filter(Boolean).join(" · ");
    if (account.email === null) return `${account.key}${name ? ` — ${name}` : ""}`;
    return `${account.email} — ${[account.key, name].filter(Boolean).join(" · ")}`;
}

function elsewhere(account: CapacityAccount): string {
    return account.email ?? account.key;
}

// A balance shows what is available; anything else shows used over limit.
function current(r: OtherResource): string {
    if (r.used === null && r.available !== null) return `${value(r.available, r.unit)} available`;
    return amount(r.used, r.limit, r.unit);
}

function renderWindow(w: WindowReport): string {
    const parts = [amount(w.used, w.limit, w.unit)];
    if (w.windowSeconds !== null) parts.push(`window ${duration(w.windowSeconds)}`);
    if (w.resetsAt !== null) parts.push(`resets ${w.resetsAt}`);
    if (w.problem !== null) {
        parts.push(`[${w.problem}]`);
    } else if (w.projection?.available) {
        parts.push(`projected ${value(round(w.projection.projectedUsage), w.unit)}`);
    } else if (w.projection) {
        parts.push(`no projection: ${PROJECTION_REASONS[w.projection.reason]}`);
    }
    if (w.exhausted) parts.push("EXHAUSTED");
    return parts.join("  ");
}

function amount(used: number | null, limit: number | null, unit: string | null): string {
    return `${value(used, unit)} / ${value(limit, unit)}`;
}

function value(n: number | null, unit: string | null): string {
    if (n === null) return "?";
    if (unit === "percent") return `${n}%`;
    return unit ? `${n} ${unit}` : `${n}`;
}

function round(n: number): number {
    return Math.round(n * 10) / 10;
}

function duration(seconds: number): string {
    if (seconds > 0 && seconds % 86_400 === 0) return `${seconds / 86_400}d`;
    if (seconds > 0 && seconds % 3_600 === 0) return `${seconds / 3_600}h`;
    if (seconds > 0 && seconds % 60 === 0) return `${seconds / 60}m`;
    return `${seconds}s`;
}
