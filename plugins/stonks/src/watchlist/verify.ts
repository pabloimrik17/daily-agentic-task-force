// Checks after each change and at the end of phase 2 (spec stonks-watchlist).
// A failure stops phase 2; nothing here repairs anything.

import type { Directive, WatchlistResult } from "../domain.ts";
import { normaliseTicker } from "../ticker.ts";
import type { Plan } from "./plan.ts";

export type Verdict = { ok: true } | { ok: false; reason: string };

export type ChangeDirective = Extract<Directive, { kind: "remove" | "add" }>;

const sortedUnique = (tickers: string[]): string[] =>
    [...new Set(tickers.map(normaliseTicker))].sort();

const fail = (reason: string): Verdict => ({ ok: false, reason });

export function verifyChange(
    before: string[],
    after: string[],
    expected: ChangeDirective,
    confirmationTicker: string | null,
): Verdict {
    const ticker = normaliseTicker(expected.ticker);
    const verb = expected.kind === "add" ? "added" : "removed";
    if (confirmationTicker === null) {
        return fail(`the confirmation names no ticker, expected ${ticker} ${verb}`);
    }
    const named = normaliseTicker(confirmationTicker);
    if (named !== ticker) {
        return fail(`the confirmation names ${named}: ${named} was ${verb} instead of ${ticker}`);
    }
    const was = sortedUnique(before);
    const now = sortedUnique(after);
    const gone = was.filter((t) => !now.includes(t));
    const appeared = now.filter((t) => !was.includes(t));
    const expectedGone = expected.kind === "remove" ? [ticker] : [];
    const expectedAppeared = expected.kind === "add" ? [ticker] : [];
    if (gone.join() === expectedGone.join() && appeared.join() === expectedAppeared.join()) {
        return { ok: true };
    }
    const parts: string[] = [];
    const missing = gone.filter((t) => !expectedGone.includes(t));
    const extra = appeared.filter((t) => !expectedAppeared.includes(t));
    if (missing.length > 0) {
        parts.push(`missing: ${missing.join(", ")}`);
    }
    if (extra.length > 0) {
        parts.push(`unexpectedly added: ${extra.join(", ")}`);
    }
    if (!gone.includes(ticker) && expected.kind === "remove") {
        parts.push(`${ticker} is still on the watchlist`);
    }
    if (!appeared.includes(ticker) && expected.kind === "add") {
        parts.push(`${ticker} is not on the watchlist`);
    }
    return fail(`the watchlist differs from "${expected.kind} ${ticker}" (${parts.join("; ")})`);
}

/** Exact set comparison; removed and added come from the plan, minus the unresolved. */
export function verifyFinal(
    desired: string[],
    final: string[],
    plan: Plan,
    unresolved: string[],
): WatchlistResult {
    const wanted = sortedUnique(desired);
    const actual = sortedUnique(final);
    const missing = wanted.filter((t) => !actual.includes(t));
    const extra = actual.filter((t) => !wanted.includes(t));
    const skipped = sortedUnique(unresolved);
    return {
        removed: [...plan.removals],
        added: plan.additions.filter((t) => !skipped.includes(t)),
        unresolved: skipped,
        final: actual,
        count: actual.length,
        capacity: plan.capacity,
        incomplete: missing.length === 0 && extra.length === 0 ? null : { missing, extra },
    };
}
