// SWS portfolio parser (design D8). The tickers come only from the holding
// links the collector gathered, read from the path
// `/stocks/<country>/<industry>/<exchange>-<ticker>/<slug>`; the derived count
// must equal the page's own counter.

import type { Listing, StockLink, SwsPortfolioRead } from "../domain.ts";
import { normaliseTicker } from "../ticker.ts";
import { array, object, string } from "../validate.ts";
import { guard, type ReadResult, unreadable, validateEnvelope } from "./envelope.ts";

/** Slug spellings that carry a tier and read as the exchange's own name. */
const KNOWN_EXCHANGES: Record<string, string> = {
    nyse: "NYSE",
    nasdaq: "Nasdaq",
    nasdaqgs: "NasdaqGS",
    nasdaqgm: "NasdaqGM",
    nasdaqcm: "NasdaqCM",
};

/**
 * The listing in a stock link's path; null when the path is not a stock
 * page. `nasdaq-hool` is exchange `Nasdaq` (no tier), which design D9 lets
 * match any Nasdaq tier; other exchanges keep the slug's spelling.
 */
/**
 * The link as a full address. Pages carry relative `/stocks/…` paths, and the
 * report and `listings.json` need a URL that opens (spec stonks-report).
 */
export function absoluteHref(href: string, pageUrl: string): string {
    let base = "https://simplywall.st";
    try {
        base = new URL(pageUrl).origin;
    } catch {
        // an unparseable page URL falls back to the site's origin
    }
    try {
        return new URL(href, base).toString();
    } catch {
        return href;
    }
}

export function listingFromHref(href: string): Listing | null {
    let path: string;
    try {
        path = new URL(href, "https://simplywall.st").pathname;
    } catch {
        return null;
    }
    const segments = path.split("/").filter((segment) => segment !== "");
    const listing = segments[0] === "stocks" && segments.length >= 4 ? segments[3] : undefined;
    const dash = listing === undefined ? -1 : listing.indexOf("-");
    if (listing === undefined || dash <= 0 || dash === listing.length - 1) {
        return null;
    }
    const exchange = listing.slice(0, dash);
    return {
        exchange: KNOWN_EXCHANGES[exchange.toLowerCase()] ?? exchange,
        ticker: normaliseTicker(listing.slice(dash + 1)),
    };
}

export function parseSwsPortfolio(envelope: unknown, runId: string): ReadResult<SwsPortfolioRead> {
    const checked = validateEnvelope(envelope, "sws-portfolio", runId);
    if (!checked.ok) {
        return checked;
    }
    return guard(() => {
        const data = checked.value.data;
        const path = "sws-portfolio.data";
        const counter = data.count;
        if (typeof counter !== "number" || !Number.isFinite(counter)) {
            return unreadable("SWS portfolio shows no holdings counter");
        }
        const links: StockLink[] = [];
        const seen = new Set<string>();
        for (const [index, raw] of array(data.links, `${path}.links`).entries()) {
            const entry = object(raw, `${path}.links[${index}]`);
            const href = string(entry, "href", `${path}.links[${index}]`);
            const text = string(entry, "text", `${path}.links[${index}]`);
            const listing = listingFromHref(href);
            if (listing === null) {
                return unreadable(`SWS portfolio link ${href} is not a /stocks/ listing path`);
            }
            if (seen.has(listing.ticker)) {
                continue;
            }
            seen.add(listing.ticker);
            const name =
                text.trim() === "" || normaliseTicker(text) === listing.ticker ? null : text.trim();
            links.push({ href: absoluteHref(href, checked.value.url), text, listing, name });
        }
        if (links.length !== counter) {
            return unreadable(
                `SWS portfolio shows ${counter} holdings but ${links.length} tickers were derived`,
            );
        }
        return {
            ok: true,
            value: { tickers: links.map((link) => link.listing.ticker), links, count: counter },
        };
    });
}
