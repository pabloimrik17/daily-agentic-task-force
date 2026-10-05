// Check C (spec stonks-reconciliation, "Check C, tracking sheet against the
// Cartera Viva"): the sheet and the IBKR holdings against the Trader's
// Cartera Viva, at ticker level. Excluded tickers are skipped entirely. C6
// adjusts nothing; when it cannot compare the trails it says so.

import type {
    ActiveOrder,
    CarteraVivaCard,
    CarteraVivaRead,
    Entry,
    Estado,
    Finding,
    IbkrRead,
    TrackingSheet,
} from "../domain.ts";
import { normaliseTicker, sameQuantity } from "../ticker.ts";
import {
    entriesByTicker,
    finding,
    formatPercent,
    formatQuantity,
    heldQuantity,
    ibkrTickers,
    liveOrders,
    sheetPosition,
} from "./findings.ts";

export function checkC(
    sheet: TrackingSheet,
    ibkr: IbkrRead,
    carteraViva: CarteraVivaRead,
    excluded: ReadonlySet<string>,
): Finding[] {
    const byTicker = entriesByTicker(sheet);
    const cards = new Map(carteraViva.cards.map((card) => [normaliseTicker(card.ticker), card]));
    const tickers = new Set([...byTicker.keys(), ...ibkrTickers(ibkr), ...cards.keys()]);
    const findings: Finding[] = [];
    for (const ticker of tickers) {
        if (excluded.has(ticker)) {
            continue;
        }
        const entries = byTicker.get(ticker) ?? [];
        const card = cards.get(ticker);
        const held = heldQuantity(ibkr, ticker);
        const buys = liveOrders(ibkr, ticker, "buy");
        const sells = liveOrders(ibkr, ticker, "sell");
        findings.push(
            ...(card === undefined
                ? traderOut(ticker, entries, held, buys)
                : traderIn(ticker, card, entries, held, buys, sells)),
        );
    }
    return findings;
}

const has = (entries: Entry[], estado: Estado): boolean =>
    entries.some((entry) => entry.estado === estado);

// ---------------------------------------------------------------------------
// The ticker is in the Cartera Viva: C2–C6

function traderIn(
    ticker: string,
    card: CarteraVivaCard,
    entries: Entry[],
    held: number,
    buys: ActiveOrder[],
    sells: ActiveOrder[],
): Finding[] {
    const isHeld = held > 0;
    return [
        ...shouldBeRoger(ticker, entries, isHeld),
        ...soldWhileIn(ticker, entries, isHeld),
        ...pendingBuy(ticker, entries, buys),
        ...(isHeld && card.trailing.activated
            ? trailingRules(ticker, card.trailing.percent, entries, sells)
            : []),
    ];
}

const inPosition = (entries: Entry[]): boolean =>
    has(entries, "Invertido") || has(entries, "Vender");

function shouldBeRoger(ticker: string, entries: Entry[], isHeld: boolean): Finding[] {
    if (isHeld || inPosition(entries) || has(entries, "Roger") || has(entries, "Comprar")) {
        return [];
    }
    return [
        finding("C2", ticker, {
            "cartera-viva": "listed",
            ibkr: "not held",
            "tracking-sheet": describeEstados(entries),
        }),
    ];
}

function soldWhileIn(ticker: string, entries: Entry[], isHeld: boolean): Finding[] {
    if (isHeld || !inPosition(entries)) {
        return [];
    }
    return [
        finding("C3", ticker, {
            "cartera-viva": "listed",
            ibkr: "not held",
            "tracking-sheet": `position ${formatQuantity(sheetPosition(entries))}`,
        }),
    ];
}

function pendingBuy(ticker: string, entries: Entry[], buys: ActiveOrder[]): Finding[] {
    if (!has(entries, "Comprar") || buys.length === 0) {
        return [];
    }
    return [
        finding("C4", ticker, {
            "cartera-viva": "listed",
            "tracking-sheet": "Comprar entry",
            ibkr: "live buy order",
        }),
    ];
}

// C5 and C6: only reached for a held ticker whose Trader's trailing is activated.
function trailingRules(
    ticker: string,
    percent: number | null,
    entries: Entry[],
    sells: ActiveOrder[],
): Finding[] {
    const traderTrail =
        percent === null ? "trailing activated" : `trailing activated at ${formatPercent(percent)}`;
    return [
        ...missingOwnTrailing(ticker, traderTrail, entries, sells),
        ...(sells.length > 0 ? compareTrails(ticker, traderTrail, percent, sells) : []),
    ];
}

function missingOwnTrailing(
    ticker: string,
    traderTrail: string,
    entries: Entry[],
    sells: ActiveOrder[],
): Finding[] {
    if (!has(entries, "Invertido") || has(entries, "Vender") || sells.length > 0) {
        return [];
    }
    return [
        finding("C5", ticker, {
            "cartera-viva": traderTrail,
            "tracking-sheet": "Invertido without Vender",
            ibkr: "no sell order",
        }),
    ];
}

function describeEstados(entries: Entry[]): string {
    if (entries.length === 0) {
        return "no entry";
    }
    const estados = [...new Set(entries.map((entry) => entry.estado))];
    return `entries in ${estados.join(" and ")}`;
}

// C6. Trail percentages compare with the quantity tolerance of D16.
function compareTrails(
    ticker: string,
    traderTrail: string,
    traderPercent: number | null,
    sells: ActiveOrder[],
): Finding[] {
    const trailing = sells.filter((order) => order.orderType === "trailing-stop");
    const sides = { "cartera-viva": traderTrail };
    if (trailing.length === 0) {
        const kinds = [...new Set(sells.map((order) => order.orderType))].join(", ");
        return [
            notEvaluableTrail(
                ticker,
                { ...sides, ibkr: `sell order of type ${kinds}, not a trailing stop` },
                "the user's sell order is not a trailing stop",
            ),
        ];
    }
    const percents = trailing.map((order) => order.trailPercent);
    if (percents.some((percent) => percent === null)) {
        return [
            notEvaluableTrail(
                ticker,
                { ...sides, ibkr: "trailing sell order with unknown trail" },
                "the user's trailing sell order has an unknown trail percentage",
            ),
        ];
    }
    const known = percents.filter((percent): percent is number => percent !== null);
    const userTrail = `trailing sell order at ${known.map(formatPercent).join(", ")}`;
    const userSides = { ...sides, ibkr: userTrail };
    if (traderPercent === null) {
        return [notEvaluableTrail(ticker, userSides, "the Trader's trail percentage is unknown")];
    }
    if (known.every((percent) => sameQuantity(percent, traderPercent))) {
        return [];
    }
    return [finding("C6", ticker, userSides)];
}

function notEvaluableTrail(
    ticker: string,
    sides: Record<string, string>,
    notEvaluable: string,
): Finding {
    return finding("C6", ticker, sides, { notEvaluable });
}

// ---------------------------------------------------------------------------
// The ticker is not in the Cartera Viva: C1, C7, C8, C9

function traderOut(ticker: string, entries: Entry[], held: number, buys: ActiveOrder[]): Finding[] {
    const isHeld = held > 0;
    return [
        ...staleRoger(ticker, entries),
        ...exitedStillIn(ticker, entries, held),
        ...soldTraderOut(ticker, entries, isHeld),
        ...liveBuyTraderOut(ticker, entries, buys),
    ];
}

function staleRoger(ticker: string, entries: Entry[]): Finding[] {
    if (!has(entries, "Roger")) {
        return [];
    }
    return [
        finding("C1", ticker, {
            "tracking-sheet": "Roger entry",
            "cartera-viva": "not listed",
        }),
    ];
}

function exitedStillIn(ticker: string, entries: Entry[], held: number): Finding[] {
    if (held <= 0 || !has(entries, "Invertido")) {
        return [];
    }
    return [
        finding("C7", ticker, {
            ibkr: `holds ${formatQuantity(held)}`,
            "tracking-sheet": "Invertido entry",
            "cartera-viva": "not listed",
        }),
    ];
}

function soldTraderOut(ticker: string, entries: Entry[], isHeld: boolean): Finding[] {
    if (isHeld || !has(entries, "Vender")) {
        return [];
    }
    return [
        finding("C8", ticker, {
            "tracking-sheet": "Vender entry",
            ibkr: "not held",
            "cartera-viva": "not listed",
        }),
    ];
}

function liveBuyTraderOut(ticker: string, entries: Entry[], buys: ActiveOrder[]): Finding[] {
    const hasComprar = has(entries, "Comprar");
    if (!hasComprar && buys.length === 0) {
        return [];
    }
    return [
        finding("C9", ticker, {
            "cartera-viva": "not listed",
            "tracking-sheet": hasComprar ? "Comprar entry" : "no Comprar entry",
            ibkr: buys.length > 0 ? "live buy order" : "no buy order",
        }),
    ];
}
