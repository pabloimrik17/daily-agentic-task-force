import type { Directive, WatchlistRead } from "../domain.ts";
import { normaliseTicker } from "../ticker.ts";

export interface Plan {
    /** Watchlist tickers that are not desired, sorted. */
    removals: string[];
    /** Desired tickers the watchlist lacks, sorted. */
    additions: string[];
    desired: string[];
    current: string[];
    capacity: number;
    /** Set when the desired set is larger than the capacity; the plan then changes nothing. */
    overCapacity: { desired: number; capacity: number } | null;
}

const sortedUnique = (tickers: string[]): string[] =>
    [...new Set(tickers.map(normaliseTicker))].sort();

export function plan(desired: string[], watchlist: WatchlistRead): Plan {
    const wanted = sortedUnique(desired);
    const current = sortedUnique(watchlist.items.map((item) => item.listing.ticker));
    const capacity = watchlist.capacity;
    if (wanted.length > capacity) {
        return {
            removals: [],
            additions: [],
            desired: wanted,
            current,
            capacity,
            overCapacity: { desired: wanted.length, capacity },
        };
    }
    return {
        removals: current.filter((ticker) => !wanted.includes(ticker)),
        additions: wanted.filter((ticker) => !current.includes(ticker)),
        desired: wanted,
        current,
        capacity,
        overCapacity: null,
    };
}

/** The directives of a plan: every removal first, then every addition. */
export function steps(p: Plan): Directive[] {
    return [
        ...p.removals.map((ticker): Directive => ({ kind: "remove", ticker })),
        ...p.additions.map((ticker): Directive => ({ kind: "add", ticker })),
    ];
}
