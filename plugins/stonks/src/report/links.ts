// Ticker links (spec stonks-report, design D11): the page read in this run,
// else the page learnt in an earlier one, else a Simply Wall St search.

import type { StockLink } from "../domain.ts";
import { normaliseTicker } from "../ticker.ts";

/** The one place the search form lives. */
export const SEARCH_URL = (ticker: string): string =>
    `https://simplywall.st/search?q=${encodeURIComponent(ticker)}`;

export interface LinkSources {
    runLinks: StockLink[];
    /** `listings.json` as read by the caller: learnt public listings, never an input to a check. */
    listings: Record<string, { symbol: string; name: string | null; url: string }>;
}

export function tickerLinks(
    tickers: string[],
    { runLinks, listings }: LinkSources,
): Record<string, string> {
    const fromRun = new Map<string, string>();
    for (const link of runLinks) {
        const ticker = normaliseTicker(link.listing.ticker);
        if (!fromRun.has(ticker)) {
            fromRun.set(ticker, link.href);
        }
    }
    const learnt = new Map<string, string>();
    for (const [key, entry] of Object.entries(listings)) {
        for (const ticker of [normaliseTicker(entry.symbol), normaliseTicker(key)]) {
            if (!learnt.has(ticker)) {
                learnt.set(ticker, entry.url);
            }
        }
    }
    const result: Record<string, string> = {};
    for (const raw of tickers) {
        const ticker = normaliseTicker(raw);
        result[ticker] = fromRun.get(ticker) ?? learnt.get(ticker) ?? SEARCH_URL(ticker);
    }
    return result;
}
