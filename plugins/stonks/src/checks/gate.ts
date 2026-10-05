// The gate (spec stonks-reconciliation, "Findings and their classification";
// design D3): a pure decision over the findings. It trips when any finding
// affects the watchlist, and names the tickers concerned. Pausing and
// resuming belong to the step machine, not here.

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
