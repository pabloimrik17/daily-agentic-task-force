// Watchlist parser (design D9). The title must be the configured watchlist's
// name, so no other watchlist is ever planned against. Per row the exact
// listing is the embedded `uniqueSymbol`, else the link slug; a Nasdaq slug
// has no tier, so its exchange is `Nasdaq` and matches any Nasdaq tier.

import type { StockLink, StonksConfig, WatchlistItem, WatchlistRead } from "../domain.ts";
import { normaliseTicker, parseListing } from "../ticker.ts";
import { array, object, string } from "../validate.ts";
import { guard, type ReadResult, unreadable, validateEnvelope } from "./envelope.ts";
import { absoluteHref, listingFromHref } from "./sws-portfolio.ts";

const COUNTER = /(\d+)\s*\/\s*(\d+)/;

function parseRow(raw: unknown, index: number, baseUrl: string): ReadResult<WatchlistItem> {
    const rowPath = `watchlist.data.rows[${index}]`;
    const row = object(raw, rowPath);
    const href = string(row, "href", rowPath);
    const text = string(row, "text", rowPath);
    const unique = typeof row.uniqueSymbol === "string" ? row.uniqueSymbol : null;
    const listing = (unique === null ? null : parseListing(unique)) ?? listingFromHref(href);
    if (listing === null) {
        return unreadable(
            `watchlist row ${index} has no uniqueSymbol and no listing in its link ${JSON.stringify(href)}`,
        );
    }
    const link: StockLink | null =
        href === ""
            ? null
            : {
                  href: absoluteHref(href, baseUrl),
                  text,
                  listing,
                  name:
                      text.trim() === "" || normaliseTicker(text) === listing.ticker
                          ? null
                          : text.trim(),
              };
    return { ok: true, value: { listing, link } };
}

export function parseWatchlist(
    envelope: unknown,
    runId: string,
    config: Pick<StonksConfig, "watchlist">,
): ReadResult<WatchlistRead> {
    const checked = validateEnvelope(envelope, "watchlist", runId);
    if (!checked.ok) {
        return checked;
    }
    return guard(() => {
        const data = checked.value.data;
        const title = typeof data.title === "string" ? data.title.trim() : null;
        if (title !== config.watchlist.name) {
            return unreadable(
                `the page shows watchlist ${JSON.stringify(title)}, the configured watchlist is ${JSON.stringify(config.watchlist.name)}`,
            );
        }
        const counter = COUNTER.exec(typeof data.counter === "string" ? data.counter : "");
        if (counter === null) {
            return unreadable("watchlist shows no N/M counter");
        }
        const items: WatchlistItem[] = [];
        for (const [index, raw] of array(data.rows, "watchlist.data.rows").entries()) {
            const item = parseRow(raw, index, checked.value.url);
            if (!item.ok) {
                return item;
            }
            items.push(item.value);
        }
        return {
            ok: true,
            value: { title, items, count: Number(counter[1]), capacity: Number(counter[2]) },
        };
    });
}
