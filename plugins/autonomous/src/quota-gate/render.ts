import type { StepResult } from "../runner.ts";
import type { WindowReport } from "./decide.ts";
import type { Projection } from "./project.ts";
import type { QuotaGateData } from "./step.ts";

const PROJECTION_REASONS: Record<Extract<Projection, { available: false }>["reason"], string> = {
    "non-positive-limit": "limit is not positive",
    "non-positive-window": "window duration is not positive",
    "no-consumption": "no consumption yet",
    "window-expired": "window already reset",
    "insufficient-elapsed": "too early in the window",
};

export function renderQuotaGate(result: StepResult<QuotaGateData>): string {
    const { account, candidates, windows, otherResources } = result.data;
    const lines = [`[${result.step}] ${result.outcome} (${result.tier})`];

    if (account) {
        const name = [account.displayName, account.plan].filter(Boolean).join(" · ");
        lines.push(`  account   ${account.key}${name ? ` — ${name}` : ""}`);
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
        lines.push(`  ${r.name.padEnd(9)} ${amount(r.used, r.limit, r.unit)}  not evaluated`);
    }
    if (!account && candidates.length > 0) {
        lines.push(
            "  candidates:",
            ...candidates.map((c) => `    - ${c.key}${c.displayName ? ` — ${c.displayName}` : ""}`),
        );
    }
    lines.push("  reasons:", ...result.reasons.map((r) => `    - ${r}`));
    return lines.join("\n");
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
