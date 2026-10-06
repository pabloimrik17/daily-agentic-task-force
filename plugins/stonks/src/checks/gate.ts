// Pure decision over the findings (spec stonks-reconciliation, design D3): it
// trips when any finding affects the watchlist. Pausing and resuming belong to
// the step machine, not here.

import type { Finding, GateDecision } from "../domain.ts";

export function decideGate(findings: Finding[]): GateDecision {
    const affected = new Set<string>();
    for (const item of findings) {
        if (item.affectsWatchlist) {
            affected.add(item.ticker);
        }
    }
    return { tripped: affected.size > 0, affectedTickers: [...affected].sort() };
}
