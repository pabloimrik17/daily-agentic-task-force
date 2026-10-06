import { describe, expect, it } from "vitest";

import type { ActiveOrder, Entry, Estado, IbkrRead, Position, TrackingSheet } from "../domain.ts";
import { checkB } from "./b.ts";

const entry = (
    ticker: string,
    estado: Estado,
    cantidad: number,
    pricePerUnit: number | null = null,
): Entry => ({ row: 0, ticker, estado, cantidad, pricePerUnit });

const sheet = (...entries: Entry[]): TrackingSheet => ({
    entries: entries.map((item, index) => ({ ...item, row: index + 2 })),
});

const position = (ticker: string, quantity: number): Position => ({ ticker, quantity });

const order = (
    ticker: string,
    side: ActiveOrder["side"],
    quantity: number,
    overrides: Partial<ActiveOrder> = {},
): ActiveOrder => ({
    ticker,
    side,
    quantity,
    orderType: "limit",
    limitPrice: null,
    trailPercent: null,
    ...overrides,
});

const buy = (ticker: string, quantity: number, limitPrice: number | null): ActiveOrder =>
    order(ticker, "buy", quantity, { limitPrice });

const trailingSell = (ticker: string, quantity: number, trailPercent: number | null): ActiveOrder =>
    order(ticker, "sell", quantity, { orderType: "trailing-stop", trailPercent });

const ibkr = (positions: Position[] = [], orders: ActiveOrder[] = []): IbkrRead => ({
    provenance: "mcp",
    positions,
    orders,
});

const none: ReadonlySet<string> = new Set();

const checks = (findings: ReturnType<typeof checkB>): string[] =>
    findings.map((item) => `${item.check} ${item.ticker}`);

describe("checkB positions", () => {
    it("trailing triggered: B1 and no alert for a Vender entry with no position and no order", () => {
        const findings = checkB(sheet(entry("WNYE", "Vender", 3)), ibkr(), none);
        expect(findings).toEqual([
            {
                check: "B1",
                ticker: "WNYE",
                sides: { "tracking-sheet": "position 3", ibkr: "not held" },
                severity: "discrepancy",
                affectsWatchlist: true,
            },
        ]);
    });

    it("position missing from the sheet: B2 when every entry is in Comprar", () => {
        const findings = checkB(
            sheet(entry("HOOL", "Comprar", 1, 30), entry("HOOL", "Comprar", 1, 29)),
            ibkr([position("HOOL", 2)], [buy("HOOL", 1, 30), buy("HOOL", 1, 29)]),
            none,
        );
        expect(findings).toEqual([
            {
                check: "B2",
                ticker: "HOOL",
                sides: { ibkr: "holds 2", "tracking-sheet": "no Invertido or Vender entry" },
                severity: "discrepancy",
                affectsWatchlist: true,
            },
        ]);
    });

    it("quantities differ: B3 stating both quantities", () => {
        const findings = checkB(
            sheet(entry("GLBX", "Invertido", 1)),
            ibkr([position("GLBX", 2)]),
            none,
        );
        expect(findings).toEqual([
            {
                check: "B3",
                ticker: "GLBX",
                sides: { ibkr: "holds 2", "tracking-sheet": "position 1" },
                severity: "discrepancy",
                affectsWatchlist: false,
            },
        ]);
    });

    it("several entries make one position that agrees with IBKR", () => {
        const findings = checkB(
            sheet(entry("INIT", "Invertido", 2), entry("INIT", "Vender", 1)),
            ibkr([position("INIT", 3)], [trailingSell("INIT", 1, 10)]),
            none,
        );
        expect(findings).toEqual([]);
    });

    it("produces nothing for a ticker that is neither held, ordered nor in position", () => {
        const findings = checkB(
            sheet(entry("UMBR", "Roger", 0), entry("CRUX", "Operativa", 0)),
            ibkr(),
            none,
        );
        expect(findings).toEqual([]);
    });

    it("excluded ticker held: no B finding for it", () => {
        const findings = checkB(sheet(), ibkr([position("ETFX", 10)]), new Set(["ETFX"]));
        expect(findings).toEqual([]);
    });

    it("ticker separators: a class share meets its position through every spelling", () => {
        const findings = checkB(
            sheet(entry("acme/b", "Invertido", 1)),
            ibkr([position("NYSE:ACME.B", 1)]),
            none,
        );
        expect(findings).toEqual([]);
    });

    it("fractional quantities: a fractional position compares numerically", () => {
        const findings = checkB(
            sheet(entry("ACME", "Invertido", 0.1), entry("ACME", "Invertido", 0.2)),
            ibkr([position("ACME", 0.3)]),
            none,
        );
        expect(findings).toEqual([]);
    });
});

describe("checkB buy orders", () => {
    it("order matches: no B4, B5 or B6 for an exact (quantity, price) pair", () => {
        const findings = checkB(
            sheet(entry("CYBD", "Comprar", 1, 42)),
            ibkr([], [buy("CYBD", 1, 42)]),
            none,
        );
        expect(findings).toEqual([]);
    });

    it("order gone: B4 for a Comprar entry with no live buy order", () => {
        const findings = checkB(sheet(entry("CYBD", "Comprar", 1, 42)), ibkr(), none);
        expect(findings).toEqual([
            {
                check: "B4",
                ticker: "CYBD",
                sides: { "tracking-sheet": "Comprar 1 at 42.00", ibkr: "no buy order" },
                severity: "discrepancy",
                affectsWatchlist: true,
            },
        ]);
    });

    it("different limit price: B6 stating 42.00 and 41.50", () => {
        const findings = checkB(
            sheet(entry("CYBD", "Comprar", 1, 42)),
            ibkr([], [buy("CYBD", 1, 41.5)]),
            none,
        );
        expect(findings).toEqual([
            {
                check: "B6",
                ticker: "CYBD",
                sides: {
                    "tracking-sheet": "Comprar 1 at 42.00",
                    ibkr: "buy order 1 limited at 41.50",
                },
                severity: "discrepancy",
                affectsWatchlist: false,
            },
        ]);
    });

    it("order without entry: B5 for a live buy order with no Comprar entry", () => {
        const findings = checkB(sheet(), ibkr([], [buy("VNDL", 1, 20)]), none);
        expect(findings).toEqual([
            {
                check: "B5",
                ticker: "VNDL",
                sides: {
                    ibkr: "buy order 1 limited at 20.00",
                    "tracking-sheet": "no Comprar entry",
                },
                severity: "discrepancy",
                affectsWatchlist: true,
            },
        ]);
    });

    it("two Comprar entries against one order: B6 pairs the lower price, B4 reports the other", () => {
        const findings = checkB(
            sheet(entry("CYBD", "Comprar", 1, 43), entry("CYBD", "Comprar", 1, 42)),
            ibkr([], [buy("CYBD", 1, 41.5)]),
            none,
        );
        expect(findings).toEqual([
            expect.objectContaining({
                check: "B6",
                sides: {
                    "tracking-sheet": "Comprar 1 at 42.00",
                    ibkr: "buy order 1 limited at 41.50",
                },
            }),
            expect.objectContaining({
                check: "B4",
                sides: { "tracking-sheet": "Comprar 1 at 43.00", ibkr: "no buy order" },
            }),
        ]);
    });

    it("removes the exact pairs before pairing the leftovers", () => {
        const findings = checkB(
            sheet(entry("CYBD", "Comprar", 1, 42), entry("CYBD", "Comprar", 2, 40)),
            ibkr([], [buy("CYBD", 2, 40), buy("CYBD", 1, 41)]),
            none,
        );
        expect(findings).toEqual([
            expect.objectContaining({
                check: "B6",
                sides: {
                    "tracking-sheet": "Comprar 1 at 42.00",
                    ibkr: "buy order 1 limited at 41.00",
                },
            }),
        ]);
    });

    it("different quantity at the same price: B6 stating both quantities", () => {
        const findings = checkB(
            sheet(entry("CYBD", "Comprar", 2, 42)),
            ibkr([], [buy("CYBD", 1, 42)]),
            none,
        );
        expect(findings).toEqual([
            expect.objectContaining({
                check: "B6",
                sides: {
                    "tracking-sheet": "Comprar 2 at 42.00",
                    ibkr: "buy order 1 limited at 42.00",
                },
            }),
        ]);
    });

    it("a Comprar entry with a blank $/u never matches exactly", () => {
        const findings = checkB(
            sheet(entry("CYBD", "Comprar", 1, null)),
            ibkr([], [buy("CYBD", 1, 42)]),
            none,
        );
        expect(findings).toEqual([
            expect.objectContaining({
                check: "B6",
                sides: {
                    "tracking-sheet": "Comprar 1 with blank $/u",
                    ibkr: "buy order 1 limited at 42.00",
                },
            }),
        ]);
    });

    it("price rounding: a limit within four decimals of the $/u matches", () => {
        const findings = checkB(
            sheet(entry("CYBD", "Comprar", 1, 42)),
            ibkr([], [buy("CYBD", 1, 42.00004)]),
            none,
        );
        expect(findings).toEqual([]);
    });

    it("reports a buy order without a limit price as B6 or B5, never as a match", () => {
        const findings = checkB(
            sheet(entry("CYBD", "Comprar", 1, 42)),
            ibkr([], [order("CYBD", "buy", 1, { orderType: "market" })]),
            none,
        );
        expect(findings).toEqual([
            expect.objectContaining({
                check: "B6",
                sides: {
                    "tracking-sheet": "Comprar 1 at 42.00",
                    ibkr: "buy order 1 with no limit price",
                },
            }),
        ]);
    });
});

describe("checkB sell orders", () => {
    it("no stop behind a Vender entry: B8 alert", () => {
        const findings = checkB(
            sheet(entry("STRK", "Vender", 3)),
            ibkr([position("STRK", 3)]),
            none,
        );
        expect(findings).toEqual([
            {
                check: "B8",
                ticker: "STRK",
                sides: { "tracking-sheet": "Vender 3", ibkr: "no sell order" },
                severity: "alert",
                affectsWatchlist: false,
            },
        ]);
    });

    it("partly sold Vender lot: B8 next to B3", () => {
        const findings = checkB(
            sheet(entry("STRK", "Vender", 3)),
            ibkr([position("STRK", 2)], [trailingSell("STRK", 2, 10)]),
            none,
        );
        expect(checks(findings)).toEqual(["B3 STRK", "B8 STRK"]);
    });

    it("stop covering fewer shares: B8 stating 3 and 2", () => {
        const findings = checkB(
            sheet(entry("STRK", "Vender", 3)),
            ibkr([position("STRK", 3)], [trailingSell("STRK", 2, 10)]),
            none,
        );
        expect(findings).toEqual([
            expect.objectContaining({
                check: "B8",
                sides: { "tracking-sheet": "Vender 3", ibkr: "sell cover 2" },
            }),
        ]);
    });

    it("stop without a Vender entry: B7 when the entries are all in Invertido", () => {
        const findings = checkB(
            sheet(entry("ACME", "Invertido", 2)),
            ibkr([position("ACME", 2)], [trailingSell("ACME", 2, 10)]),
            none,
        );
        expect(findings).toEqual([
            {
                check: "B7",
                ticker: "ACME",
                sides: { ibkr: "sell cover 2", "tracking-sheet": "no Vender entry" },
                severity: "discrepancy",
                affectsWatchlist: true,
            },
        ]);
    });

    it("sell orders beyond the Vender total: B7 stating both totals", () => {
        const findings = checkB(
            sheet(entry("ACME", "Vender", 1)),
            ibkr([position("ACME", 1)], [trailingSell("ACME", 1, 10), order("ACME", "sell", 1)]),
            none,
        );
        expect(findings).toEqual([
            expect.objectContaining({
                check: "B7",
                sides: { ibkr: "sell cover 2", "tracking-sheet": "Vender 1" },
            }),
        ]);
    });

    it("sell cover equal to the Vender total: neither B7 nor B8", () => {
        const findings = checkB(
            sheet(entry("STRK", "Vender", 1), entry("STRK", "Vender", 2)),
            ibkr([position("STRK", 3)], [trailingSell("STRK", 3, 10)]),
            none,
        );
        expect(findings).toEqual([]);
    });

    it("a Vender total above the sell cover on a ticker not held is B1, not B8", () => {
        const findings = checkB(
            sheet(entry("WNYE", "Vender", 3)),
            ibkr([], [trailingSell("WNYE", 1, 10)]),
            none,
        );
        expect(checks(findings)).toEqual(["B1 WNYE"]);
    });
});
