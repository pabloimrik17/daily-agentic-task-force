// Ticker normalisation (design D16): every input parser and every check
// compares tickers through this one function, so `brk.b`, `BRK/B`, `BRK B`
// and `NYSE:BRK.B` all meet as `BRK.B`.

import type { Listing } from "./domain.ts";

const CLASS_SEPARATORS = /[/\s]+/g;

/** Upper-case, trimmed, class separators unified to `.`, exchange prefix removed. */
export function normaliseTicker(raw: string): string {
    const trimmed = raw.trim();
    const colon = trimmed.lastIndexOf(":");
    const symbol = colon === -1 ? trimmed : trimmed.slice(colon + 1);
    return symbol.trim().toUpperCase().replace(CLASS_SEPARATORS, ".");
}

/** Splits `EXCHANGE:TICKER`; null when there is no exchange part. */
export function parseListing(raw: string): Listing | null {
    const trimmed = raw.trim();
    const colon = trimmed.indexOf(":");
    if (colon <= 0 || colon === trimmed.length - 1) {
        return null;
    }
    return {
        exchange: trimmed.slice(0, colon).trim(),
        ticker: normaliseTicker(trimmed.slice(colon + 1)),
    };
}

/** Quantities are equal when they differ by less than 1e-6 (design D16). */
export function sameQuantity(a: number, b: number): boolean {
    return Math.abs(a - b) < 1e-6;
}

/** Prices are compared after rounding to four decimals (design D16). */
export function roundPrice(price: number): number {
    return Math.round(price * 10000) / 10000;
}

export function samePrice(a: number, b: number): boolean {
    return roundPrice(a) === roundPrice(b);
}
