import type { CarteraVivaCard, DropdownRow, Listing } from "../domain.ts";
import { formatListing } from "../domain.ts";
import { normaliseTicker, parseListing } from "../ticker.ts";
import type { Listings } from "./listings.ts";
import { isUsPrimary } from "./listings.ts";

export type Target = { kind: "known"; listing: Listing } | { kind: "any-us"; ticker: string };

export type Selection =
    | { kind: "selected"; row: DropdownRow }
    | { kind: "unresolved"; reason: string; candidates: DropdownRow[] };

/** The learnt listing when it is US primary, otherwise the ticker on any US primary exchange. */
export function target(ticker: string, listings: Listings): Target {
    const symbol = normaliseTicker(ticker);
    const learnt = listings[symbol] === undefined ? null : parseListing(listings[symbol].symbol);
    if (learnt !== null && isUsPrimary(learnt.exchange)) {
        return { kind: "known", listing: learnt };
    }
    return { kind: "any-us", ticker: symbol };
}

/** The learnt name, else the Cartera Viva card's name, else null: Claude chooses the term. */
export function searchTerm(
    ticker: string,
    listings: Listings,
    carteraViva: CarteraVivaCard[],
): string | null {
    const symbol = normaliseTicker(ticker);
    const learnt = listings[symbol]?.name;
    if (learnt !== undefined && learnt !== null && learnt !== "") {
        return learnt;
    }
    const card = carteraViva.find((c) => normaliseTicker(c.ticker) === symbol);
    return card?.name != null && card.name !== "" ? card.name : null;
}

/** A Nasdaq slug without a tier matches any Nasdaq tier. */
export function sameExchange(a: string, b: string): boolean {
    if (a === b) {
        return true;
    }
    return (a === "Nasdaq" && b.startsWith("Nasdaq")) || (b === "Nasdaq" && a.startsWith("Nasdaq"));
}

export function select(rows: DropdownRow[], wanted: Target): Selection {
    const ticker = wanted.kind === "known" ? normaliseTicker(wanted.listing.ticker) : wanted.ticker;
    const sameTicker = rows.filter(
        (row) => row.listing !== null && normaliseTicker(row.listing.ticker) === ticker,
    );
    const matches = sameTicker.filter((row) => {
        const listing = row.listing as Listing;
        return wanted.kind === "known"
            ? sameExchange(listing.exchange, wanted.listing.exchange)
            : isUsPrimary(listing.exchange);
    });
    const [only] = matches;
    if (matches.length === 1 && only !== undefined) {
        return { kind: "selected", row: only };
    }
    const wantedText =
        wanted.kind === "known"
            ? formatListing(wanted.listing)
            : `${ticker} on a US primary exchange`;
    return {
        kind: "unresolved",
        reason:
            matches.length === 0
                ? `no result is exactly ${wantedText}`
                : `${matches.length} results are exactly ${wantedText}`,
        candidates: sameTicker,
    };
}
