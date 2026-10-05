// Watchlist candidates (spec stonks-watchlist, CONTEXT.md): a ticker whose
// every entry in the tracking sheet is Comprar, Roger or Operativa.

import type { Estado, TrackingSheet } from "../domain.ts";
import { normaliseTicker } from "../ticker.ts";

const QUALIFYING: readonly Estado[] = ["Comprar", "Roger", "Operativa"];

/** Sorted, unique, normalised tickers with at least one entry, all of them qualifying. */
export function candidates(sheet: TrackingSheet): string[] {
    const qualifies = new Map<string, boolean>();
    for (const entry of sheet.entries) {
        const ticker = normaliseTicker(entry.ticker);
        const ok = QUALIFYING.includes(entry.estado) && (qualifies.get(ticker) ?? true);
        qualifies.set(ticker, ok);
    }
    return [...qualifies.entries()]
        .filter(([, ok]) => ok)
        .map(([ticker]) => ticker)
        .sort();
}
