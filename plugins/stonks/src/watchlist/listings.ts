// The learnt listings reference data (design D11). Public facts about
// listings, never input to a check. File I/O lives in the integration step.

import type { Listing, StockLink } from "../domain.ts";
import { formatListing } from "../domain.ts";
import { normaliseTicker, parseListing } from "../ticker.ts";

export interface LearntListing {
    /** Exchange-qualified, `NasdaqGS:HOOL`. */
    symbol: string;
    name: string | null;
    url: string;
}

/** Keyed by normalised ticker. */
export type Listings = Record<string, LearntListing>;

const US_PRIMARY_EXCHANGES = ["NYSE", "NasdaqGS", "NasdaqGM", "NasdaqCM"];

/** A Nasdaq slug carries no tier (design D9), so a bare `Nasdaq` also counts as US primary. */
export function isUsPrimary(exchange: string): boolean {
    return exchange === "Nasdaq" || US_PRIMARY_EXCHANGES.includes(exchange);
}

export function parseListings(text: string): { listings: Listings; warning: string | null } {
    if (text.trim() === "") {
        return { listings: {}, warning: null };
    }
    const reject = (why: string) => ({ listings: {}, warning: `listings.json ignored: ${why}` });
    let raw: unknown;
    try {
        raw = JSON.parse(text);
    } catch {
        return reject("not valid JSON");
    }
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
        return reject("not an object");
    }
    const listings: Listings = {};
    for (const [key, value] of Object.entries(raw)) {
        if (typeof value !== "object" || value === null) {
            return reject(`entry ${key} is not an object`);
        }
        const { symbol, name, url } = value as Record<string, unknown>;
        const parsed = typeof symbol === "string" ? parseListing(symbol) : null;
        if (
            parsed === null ||
            (name !== null && typeof name !== "string") ||
            typeof url !== "string" ||
            normaliseTicker(key) !== key ||
            parsed.ticker !== key
        ) {
            return reject(`entry ${key} has an unknown shape`);
        }
        listings[key] = { symbol: formatListing(parsed), name, url };
    }
    return { listings, warning: null };
}

export function serialiseListings(listings: Listings): string {
    const sorted = Object.fromEntries(
        Object.entries(listings).sort(([a], [b]) => a.localeCompare(b)),
    );
    return `${JSON.stringify(sorted, null, 4)}\n`;
}

/** A US-primary listing replaces a non-US one; otherwise the first learnt wins (a missing name is filled in). */
export function learnAddition(
    listings: Listings,
    listing: Listing,
    name: string | null,
    url: string,
): Listings {
    const ticker = normaliseTicker(listing.ticker);
    const incoming: LearntListing = {
        symbol: formatListing({ exchange: listing.exchange, ticker }),
        name,
        url,
    };
    const known = listings[ticker];
    if (known === undefined) {
        return { ...listings, [ticker]: incoming };
    }
    const knownExchange = parseListing(known.symbol)?.exchange ?? "";
    if (isUsPrimary(listing.exchange) && !isUsPrimary(knownExchange)) {
        return { ...listings, [ticker]: { ...incoming, name: name ?? known.name } };
    }
    if (known.name === null && name !== null) {
        return { ...listings, [ticker]: { ...known, name } };
    }
    return listings;
}

export function learnFromLinks(listings: Listings, links: StockLink[]): Listings {
    return links.reduce(
        (acc, link) => learnAddition(acc, link.listing, link.name, link.href),
        listings,
    );
}
