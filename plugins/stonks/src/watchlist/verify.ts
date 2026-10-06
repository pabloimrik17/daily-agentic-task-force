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

/**
 * The change against a fresh read alone: Simply Wall St's confirmations name
 * no ticker (design D10), so the read is what tells the right change apart.
 */
export function verifyChange(
    before: string[],
    after: string[],
    expected: ChangeDirective,
): Verdict {
    const ticker = normaliseTicker(expected.ticker);
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
    // A wrong listing: one other ticker arrived in place of the expected one.
    if (
        expected.kind === "add" &&
        gone.length === 0 &&
        appeared.length === 1 &&
        extra.length === 1
    ) {
        return fail(`${extra[0]} was added instead of ${ticker}`);
    }
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
