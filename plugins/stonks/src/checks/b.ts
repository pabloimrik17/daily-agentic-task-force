// Check B (spec stonks-reconciliation, the three "Check B" requirements):
// the tracking sheet against IBKR, per ticker. Positions (B1–B3), buy
// matching (B4–B6, design D16) and sell coverage (B7, B8). Excluded tickers
// are skipped entirely.

import type { ActiveOrder, Entry, Finding, IbkrRead, TrackingSheet } from "../domain.ts";
import { samePrice, sameQuantity } from "../ticker.ts";
import {
    entriesByTicker,
    finding,
    formatPrice,
    formatQuantity,
    heldQuantity,
    ibkrTickers,
    liveOrders,
    sheetPosition,
} from "./findings.ts";

export function checkB(
    sheet: TrackingSheet,
    ibkr: IbkrRead,
    excluded: ReadonlySet<string>,
): Finding[] {
    const byTicker = entriesByTicker(sheet);
    const tickers = new Set([...byTicker.keys(), ...ibkrTickers(ibkr)]);
    const findings: Finding[] = [];
    for (const ticker of tickers) {
        if (excluded.has(ticker)) {
            continue;
        }
        const entries = byTicker.get(ticker) ?? [];
        const held = heldQuantity(ibkr, ticker);
        findings.push(
            ...checkPositions(ticker, entries, held),
            ...matchBuys(ticker, entries, liveOrders(ibkr, ticker, "buy")),
            ...checkSellCover(ticker, entries, held, liveOrders(ibkr, ticker, "sell")),
        );
    }
    return findings;
}

// ---------------------------------------------------------------------------
// B1–B3, positions

function checkPositions(ticker: string, entries: Entry[], held: number): Finding[] {
    const positionEntries = entries.filter(
        (entry) => entry.estado === "Invertido" || entry.estado === "Vender",
    );
    const isHeld = held > 0;
    if (positionEntries.length === 0) {
        return isHeld
            ? [
                  finding("B2", ticker, {
                      ibkr: `holds ${formatQuantity(held)}`,
                      "tracking-sheet": "no Invertido or Vender entry",
                  }),
              ]
            : [];
    }
    const position = sheetPosition(entries);
    if (!isHeld) {
        return [
            finding("B1", ticker, {
                "tracking-sheet": `position ${formatQuantity(position)}`,
                ibkr: "not held",
            }),
        ];
    }
    if (!sameQuantity(position, held)) {
        return [
            finding("B3", ticker, {
                ibkr: `holds ${formatQuantity(held)}`,
                "tracking-sheet": `position ${formatQuantity(position)}`,
            }),
        ];
    }
    return [];
}

// ---------------------------------------------------------------------------
// B4–B6, buy matching (design D16)

const exactMatch = (entry: Entry, order: ActiveOrder): boolean =>
    sameQuantity(entry.cantidad, order.quantity) &&
    entry.pricePerUnit !== null &&
    order.limitPrice !== null &&
    samePrice(entry.pricePerUnit, order.limitPrice);

// Ascending price; a blank price sorts last, so a priced pair is preferred.
function priceOrder(a: number | null, b: number | null): number {
    if (a === null || b === null) {
        return a === b ? 0 : a === null ? 1 : -1;
    }
    return a - b;
}

const describeEntry = (entry: Entry): string =>
    entry.pricePerUnit === null
        ? `Comprar ${formatQuantity(entry.cantidad)} with blank $/u`
        : `Comprar ${formatQuantity(entry.cantidad)} at ${formatPrice(entry.pricePerUnit)}`;

const describeBuyOrder = (order: ActiveOrder): string =>
    order.limitPrice === null
        ? `buy order ${formatQuantity(order.quantity)} with no limit price`
        : `buy order ${formatQuantity(order.quantity)} limited at ${formatPrice(order.limitPrice)}`;

function matchBuys(ticker: string, entries: Entry[], buys: ActiveOrder[]): Finding[] {
    const remainingOrders = [...buys];
    const remainingEntries: Entry[] = [];
    for (const entry of entries.filter((candidate) => candidate.estado === "Comprar")) {
        const index = remainingOrders.findIndex((order) => exactMatch(entry, order));
        if (index === -1) {
            remainingEntries.push(entry);
        } else {
            remainingOrders.splice(index, 1);
        }
    }
    remainingEntries.sort((a, b) => priceOrder(a.pricePerUnit, b.pricePerUnit));
    remainingOrders.sort((a, b) => priceOrder(a.limitPrice, b.limitPrice));
    const pairs = Math.min(remainingEntries.length, remainingOrders.length);
    const findings: Finding[] = [];
    for (let index = 0; index < pairs; index += 1) {
        const entry = remainingEntries[index];
        const order = remainingOrders[index];
        if (entry !== undefined && order !== undefined) {
            findings.push(
                finding("B6", ticker, {
                    "tracking-sheet": describeEntry(entry),
                    ibkr: describeBuyOrder(order),
                }),
            );
        }
    }
    for (const entry of remainingEntries.slice(pairs)) {
        findings.push(
            finding("B4", ticker, { "tracking-sheet": describeEntry(entry), ibkr: "no buy order" }),
        );
    }
    for (const order of remainingOrders.slice(pairs)) {
        findings.push(
            finding("B5", ticker, {
                ibkr: describeBuyOrder(order),
                "tracking-sheet": "no Comprar entry",
            }),
        );
    }
    return findings;
}

// ---------------------------------------------------------------------------
// B7 and B8, sell coverage: totals only, never prices

const sum = (values: number[]): number => values.reduce((total, value) => total + value, 0);

function checkSellCover(
    ticker: string,
    entries: Entry[],
    held: number,
    sells: ActiveOrder[],
): Finding[] {
    const vender = entries.filter((entry) => entry.estado === "Vender");
    const venderTotal = sum(vender.map((entry) => entry.cantidad));
    const sellCover = sum(sells.map((order) => order.quantity));
    if (sameQuantity(venderTotal, sellCover)) {
        return [];
    }
    if (sellCover < venderTotal) {
        return held > 0
            ? [
                  finding("B8", ticker, {
                      "tracking-sheet": `Vender ${formatQuantity(venderTotal)}`,
                      ibkr:
                          sells.length === 0
                              ? "no sell order"
                              : `sell cover ${formatQuantity(sellCover)}`,
                  }),
              ]
            : [];
    }
    return [
        finding("B7", ticker, {
            ibkr: `sell cover ${formatQuantity(sellCover)}`,
            "tracking-sheet":
                vender.length === 0 ? "no Vender entry" : `Vender ${formatQuantity(venderTotal)}`,
        }),
    ];
}
