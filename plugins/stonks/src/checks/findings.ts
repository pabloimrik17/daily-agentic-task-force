// Severity and the watchlist mark depend on the check identifier alone, so
// every check builds its findings through `finding` and none can disagree with
// the tables below. Tickers meet here through `normaliseTicker`, so a check
// never compares two spellings of one symbol (spec stonks-reconciliation,
// design D3 and D16).

import type {
    ActiveOrder,
    CheckId,
    Entry,
    Finding,
    IbkrRead,
    OrderSide,
    Severity,
    TrackingSheet,
} from "../domain.ts";
import { normaliseTicker, roundPrice } from "../ticker.ts";

export const SEVERITY_OF: Record<CheckId, Severity> = {
    A1: "discrepancy",
    A2: "discrepancy",
    B1: "discrepancy",
    B2: "discrepancy",
    B3: "discrepancy",
    B4: "discrepancy",
    B5: "discrepancy",
    B6: "discrepancy",
    B7: "discrepancy",
    B8: "alert",
    C1: "discrepancy",
    C2: "discrepancy",
    C3: "discrepancy",
    C4: "informational",
    C5: "warning",
    C6: "warning",
    C7: "discrepancy",
    C8: "discrepancy",
    C9: "informational",
};

/** The findings that trip the gate (design D3); no other finding does. */
export const AFFECTS_WATCHLIST: ReadonlySet<CheckId> = new Set<CheckId>([
    "B1",
    "B2",
    "B4",
    "B5",
    "B7",
    "C1",
    "C2",
    "C3",
    "C7",
    "C8",
]);

export interface FindingOptions {
    /** Reports the finding as not evaluable, for this reason; C6 uses it. */
    notEvaluable?: string;
}

export function finding(
    check: CheckId,
    ticker: string,
    sides: Finding["sides"],
    options: FindingOptions = {},
): Finding {
    if (options.notEvaluable !== undefined) {
        return {
            check,
            ticker,
            sides,
            severity: "not-evaluable",
            affectsWatchlist: false,
            reason: options.notEvaluable,
        };
    }
    return {
        check,
        ticker,
        sides,
        severity: SEVERITY_OF[check],
        affectsWatchlist: AFFECTS_WATCHLIST.has(check),
    };
}

const POSITION_ESTADOS = new Set<Entry["estado"]>(["Invertido", "Vender"]);

const sum = (values: number[]): number => values.reduce((total, value) => total + value, 0);

/** Shares IBKR holds in the ticker: the sum of its Positions above zero. */
export function heldQuantity(ibkr: IbkrRead, ticker: string): number {
    const wanted = normaliseTicker(ticker);
    return sum(
        ibkr.positions
            .filter(
                (position) => position.quantity > 0 && normaliseTicker(position.ticker) === wanted,
            )
            .map((position) => position.quantity),
    );
}

/** The tickers IBKR holds, normalised. */
export function heldTickers(ibkr: IbkrRead): Set<string> {
    const held = new Set<string>();
    for (const position of ibkr.positions) {
        if (position.quantity > 0) {
            held.add(normaliseTicker(position.ticker));
        }
    }
    return held;
}

/** Every ticker IBKR mentions, in a held Position or an Active order. */
export function ibkrTickers(ibkr: IbkrRead): Set<string> {
    const tickers = heldTickers(ibkr);
    for (const order of ibkr.orders) {
        tickers.add(normaliseTicker(order.ticker));
    }
    return tickers;
}

/** The tracking sheet's position: the sum of Cantidad over Invertido and Vender. */
export function sheetPosition(entries: Entry[]): number {
    return sum(
        entries
            .filter((entry) => POSITION_ESTADOS.has(entry.estado))
            .map((entry) => entry.cantidad),
    );
}

/** The sheet's entries grouped by normalised ticker, in row order. */
export function entriesByTicker(sheet: TrackingSheet): Map<string, Entry[]> {
    const byTicker = new Map<string, Entry[]>();
    for (const entry of sheet.entries) {
        const ticker = normaliseTicker(entry.ticker);
        const entries = byTicker.get(ticker);
        if (entries === undefined) {
            byTicker.set(ticker, [entry]);
        } else {
            entries.push(entry);
        }
    }
    return byTicker;
}

/** The Active orders of one side on the ticker. */
export function liveOrders(ibkr: IbkrRead, ticker: string, side: OrderSide): ActiveOrder[] {
    const wanted = normaliseTicker(ticker);
    return ibkr.orders.filter(
        (order) => order.side === side && normaliseTicker(order.ticker) === wanted,
    );
}

/** A quantity as the sheet would show it: `2`, `0.5`; sums are rounded to the 1e-6 of D16. */
export function formatQuantity(quantity: number): string {
    return String(Math.round(quantity * 1_000_000) / 1_000_000);
}

/** A price with two decimals, or four when the rounded price needs them: `42.00`, `41.5025`. */
export function formatPrice(price: number): string {
    const rounded = roundPrice(price);
    const cents = Math.round(rounded * 100) / 100;
    return cents === rounded ? rounded.toFixed(2) : rounded.toFixed(4);
}

export function formatPercent(percent: number): string {
    return `${formatQuantity(percent)}%`;
}
