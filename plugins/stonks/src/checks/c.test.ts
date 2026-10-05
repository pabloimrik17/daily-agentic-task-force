import { describe, expect, it } from "vitest";

import type {
    ActiveOrder,
    CarteraVivaCard,
    CarteraVivaRead,
    Entry,
    Estado,
    IbkrRead,
    Position,
    TraderTrailing,
    TrackingSheet,
} from "../domain.ts";
import { checkB } from "./b.ts";
import { checkC } from "./c.ts";
import { decideGate } from "./gate.ts";

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

const card = (
    ticker: string,
    trailing: TraderTrailing = { activated: false },
): CarteraVivaCard => ({
    ticker,
    averagePrice: null,
    trailing,
    name: null,
});

const activated = (percent: number | null): TraderTrailing => ({ activated: true, percent });

const cartera = (...cards: CarteraVivaCard[]): CarteraVivaRead => ({ cards });

const none: ReadonlySet<string> = new Set();

const checks = (findings: ReturnType<typeof checkC>): string[] =>
    findings.map((item) => `${item.check} ${item.ticker}`);

describe("checkC, the Trader is out", () => {
    it("trader exited a Roger: C1", () => {
        const findings = checkC(sheet(entry("UMBR", "Roger", 0, 12)), ibkr(), cartera(), none);
        expect(findings).toEqual([
            {
                check: "C1",
                ticker: "UMBR",
                sides: { "tracking-sheet": "Roger entry", "cartera-viva": "not listed" },
                severity: "discrepancy",
                affectsWatchlist: true,
            },
        ]);
    });

    it("vender sold, Trader out: C8 along with the B1 Discrepancy", () => {
        const tracking = sheet(entry("WNYE", "Vender", 3));
        const read = ibkr();
        expect(checkC(tracking, read, cartera(), none)).toEqual([
            {
                check: "C8",
                ticker: "WNYE",
                sides: {
                    "tracking-sheet": "Vender entry",
                    ibkr: "not held",
                    "cartera-viva": "not listed",
                },
                severity: "discrepancy",
                affectsWatchlist: true,
            },
        ]);
        expect(checks(checkB(tracking, read, none))).toEqual(["B1 WNYE"]);
    });

    it("vender still held with its stop: no C8, and the gate is not tripped by it", () => {
        const tracking = sheet(entry("STRK", "Vender", 3));
        const read = ibkr([position("STRK", 3)], [trailingSell("STRK", 3, 10)]);
        const findings = [
            ...checkB(tracking, read, none),
            ...checkC(tracking, read, cartera(), none),
        ];
        expect(findings).toEqual([]);
        expect(decideGate(findings)).toEqual({ tripped: false, affectedTickers: [] });
    });

    it("C8 does not fire while IBKR still holds the ticker, even without enough cover", () => {
        const findings = checkC(
            sheet(entry("STRK", "Vender", 3)),
            ibkr([position("STRK", 3)]),
            cartera(),
            none,
        );
        expect(findings).toEqual([]);
    });

    it("trader exited a held ticker: C7", () => {
        const findings = checkC(
            sheet(entry("TYRL", "Invertido", 1)),
            ibkr([position("TYRL", 1)]),
            cartera(),
            none,
        );
        expect(findings).toEqual([
            {
                check: "C7",
                ticker: "TYRL",
                sides: {
                    ibkr: "holds 1",
                    "tracking-sheet": "Invertido entry",
                    "cartera-viva": "not listed",
                },
                severity: "discrepancy",
                affectsWatchlist: true,
            },
        ]);
    });

    it("pending buy on a ticker the Trader is not in: C9 for a live buy order", () => {
        const findings = checkC(sheet(), ibkr([], [buy("VNDL", 1, 20)]), cartera(), none);
        expect(findings).toEqual([
            {
                check: "C9",
                ticker: "VNDL",
                sides: {
                    "cartera-viva": "not listed",
                    "tracking-sheet": "no Comprar entry",
                    ibkr: "live buy order",
                },
                severity: "informational",
                affectsWatchlist: false,
            },
        ]);
    });

    it("C9 also fires for a Comprar entry without a live buy order", () => {
        const findings = checkC(sheet(entry("CYBD", "Comprar", 1, 42)), ibkr(), cartera(), none);
        expect(findings).toEqual([
            expect.objectContaining({
                check: "C9",
                ticker: "CYBD",
                sides: {
                    "cartera-viva": "not listed",
                    "tracking-sheet": "Comprar entry",
                    ibkr: "no buy order",
                },
            }),
        ]);
    });

    it("produces nothing for a held Vender ticker the Trader left, nor for Operativa and En espera", () => {
        const findings = checkC(
            sheet(
                entry("STRK", "Vender", 3),
                entry("CRUX", "Operativa", 0),
                entry("HOOL", "En espera", 0),
            ),
            ibkr([position("STRK", 3)], [trailingSell("STRK", 3, 10)]),
            cartera(),
            none,
        );
        expect(findings).toEqual([]);
    });
});

describe("checkC, the Trader is in", () => {
    it("trader entered a ticker under watch: C2 when all entries are in Operativa", () => {
        const findings = checkC(
            sheet(entry("HOOL", "Operativa", 0)),
            ibkr(),
            cartera(card("HOOL")),
            none,
        );
        expect(findings).toEqual([
            {
                check: "C2",
                ticker: "HOOL",
                sides: {
                    "cartera-viva": "listed",
                    ibkr: "not held",
                    "tracking-sheet": "entries in Operativa",
                },
                severity: "discrepancy",
                affectsWatchlist: true,
            },
        ]);
    });

    it("no sheet entry still counts for C2", () => {
        const findings = checkC(sheet(), ibkr(), cartera(card("CRUX")), none);
        expect(findings).toEqual([
            expect.objectContaining({
                check: "C2",
                ticker: "CRUX",
                sides: { "cartera-viva": "listed", ibkr: "not held", "tracking-sheet": "no entry" },
            }),
        ]);
    });

    it("no C2 for a Roger entry, a Comprar entry or a held ticker", () => {
        const findings = checkC(
            sheet(entry("UMBR", "Roger", 0, 12), entry("CYBD", "Comprar", 1, 42)),
            ibkr([position("ACME", 1)]),
            cartera(card("UMBR"), card("CYBD"), card("ACME")),
            none,
        );
        expect(findings).toEqual([]);
    });

    it("trailing triggered while the Trader stays: C3 along with the B1 Discrepancy", () => {
        const tracking = sheet(entry("WNYE", "Vender", 3));
        const read = ibkr();
        expect(checkC(tracking, read, cartera(card("WNYE")), none)).toEqual([
            {
                check: "C3",
                ticker: "WNYE",
                sides: {
                    "cartera-viva": "listed",
                    ibkr: "not held",
                    "tracking-sheet": "position 3",
                },
                severity: "discrepancy",
                affectsWatchlist: true,
            },
        ]);
        expect(checks(checkB(tracking, read, none))).toEqual(["B1 WNYE"]);
    });

    it("pending buy with the Trader in: C4 is informational", () => {
        const findings = checkC(
            sheet(entry("CYBD", "Comprar", 1, 42)),
            ibkr([], [buy("CYBD", 1, 42)]),
            cartera(card("CYBD")),
            none,
        );
        expect(findings).toEqual([
            {
                check: "C4",
                ticker: "CYBD",
                sides: {
                    "cartera-viva": "listed",
                    "tracking-sheet": "Comprar entry",
                    ibkr: "live buy order",
                },
                severity: "informational",
                affectsWatchlist: false,
            },
        ]);
    });

    it("trader's trailing not activated: no C5", () => {
        const findings = checkC(
            sheet(entry("GLBX", "Invertido", 2)),
            ibkr([position("GLBX", 2)]),
            cartera(card("GLBX")),
            none,
        );
        expect(findings).toEqual([]);
    });

    it("missing own trailing: C5 warning when the Trader's trailing is activated", () => {
        const findings = checkC(
            sheet(entry("GLBX", "Invertido", 2)),
            ibkr([position("GLBX", 2)]),
            cartera(card("GLBX", activated(12))),
            none,
        );
        expect(findings).toEqual([
            {
                check: "C5",
                ticker: "GLBX",
                sides: {
                    "cartera-viva": "trailing activated at 12%",
                    "tracking-sheet": "Invertido without Vender",
                    ibkr: "no sell order",
                },
                severity: "warning",
                affectsWatchlist: false,
            },
        ]);
    });

    it("no C5 when a Vender entry or a sell order exists", () => {
        const withVender = checkC(
            sheet(entry("GLBX", "Invertido", 1), entry("GLBX", "Vender", 1)),
            ibkr([position("GLBX", 2)]),
            cartera(card("GLBX", activated(12))),
            none,
        );
        expect(withVender).toEqual([]);
        const withSell = checkC(
            sheet(entry("GLBX", "Invertido", 2)),
            ibkr([position("GLBX", 2)], [trailingSell("GLBX", 2, 12)]),
            cartera(card("GLBX", activated(12))),
            none,
        );
        expect(withSell).toEqual([]);
    });

    it("trail percentages differ: C6 warning stating 10% and 15%, no order changed", () => {
        const read = ibkr([position("INIT", 3)], [trailingSell("INIT", 3, 15)]);
        const before = structuredClone(read);
        const findings = checkC(
            sheet(entry("INIT", "Vender", 3)),
            read,
            cartera(card("INIT", activated(10))),
            none,
        );
        expect(findings).toEqual([
            {
                check: "C6",
                ticker: "INIT",
                sides: {
                    "cartera-viva": "trailing activated at 10%",
                    ibkr: "trailing sell order at 15%",
                },
                severity: "warning",
                affectsWatchlist: false,
            },
        ]);
        expect(read).toEqual(before);
    });

    it("trail percentage unknown: C6 is not evaluable", () => {
        const findings = checkC(
            sheet(entry("INIT", "Vender", 3)),
            ibkr([position("INIT", 3)], [trailingSell("INIT", 3, null)]),
            cartera(card("INIT", activated(10))),
            none,
        );
        expect(findings).toEqual([
            {
                check: "C6",
                ticker: "INIT",
                sides: {
                    "cartera-viva": "trailing activated at 10%",
                    ibkr: "trailing sell order with unknown trail",
                },
                severity: "not-evaluable",
                affectsWatchlist: false,
                reason: "the user's trailing sell order has an unknown trail percentage",
            },
        ]);
    });

    it("sell order that is not a trailing stop: C6 is not evaluable with the reason", () => {
        const findings = checkC(
            sheet(entry("INIT", "Vender", 3)),
            ibkr([position("INIT", 3)], [order("INIT", "sell", 3, { orderType: "stop" })]),
            cartera(card("INIT", activated(10))),
            none,
        );
        expect(findings).toEqual([
            expect.objectContaining({
                check: "C6",
                severity: "not-evaluable",
                sides: {
                    "cartera-viva": "trailing activated at 10%",
                    ibkr: "sell order of type stop, not a trailing stop",
                },
                reason: "the user's sell order is not a trailing stop",
            }),
        ]);
    });

    it("trader's trail percentage unknown: C6 is not evaluable with the reason", () => {
        const findings = checkC(
            sheet(entry("INIT", "Vender", 3)),
            ibkr([position("INIT", 3)], [trailingSell("INIT", 3, 15)]),
            cartera(card("INIT", activated(null))),
            none,
        );
        expect(findings).toEqual([
            expect.objectContaining({
                check: "C6",
                severity: "not-evaluable",
                sides: { "cartera-viva": "trailing activated", ibkr: "trailing sell order at 15%" },
                reason: "the Trader's trail percentage is unknown",
            }),
        ]);
    });

    it("equal trail percentages: no C6", () => {
        const findings = checkC(
            sheet(entry("INIT", "Vender", 3)),
            ibkr([position("INIT", 3)], [trailingSell("INIT", 3, 10)]),
            cartera(card("INIT", activated(10))),
            none,
        );
        expect(findings).toEqual([]);
    });

    it("no C6 when the Trader's trailing is not activated or the ticker is not held", () => {
        const notActivated = checkC(
            sheet(entry("INIT", "Vender", 3)),
            ibkr([position("INIT", 3)], [trailingSell("INIT", 3, 15)]),
            cartera(card("INIT")),
            none,
        );
        expect(notActivated).toEqual([]);
        const notHeld = checkC(
            sheet(entry("INIT", "Comprar", 3, 20)),
            ibkr([], [trailingSell("INIT", 3, 15)]),
            cartera(card("INIT", activated(10))),
            none,
        );
        expect(notHeld).toEqual([]);
    });

    it("excluded ticker held: no C finding for it", () => {
        const findings = checkC(
            sheet(),
            ibkr([position("ETFX", 10)]),
            cartera(card("ETFX")),
            new Set(["ETFX"]),
        );
        expect(findings).toEqual([]);
    });

    it("compares the Cartera Viva's tickers by symbol", () => {
        const findings = checkC(
            sheet(entry("ACME.B", "Invertido", 1)),
            ibkr([position("ACME/B", 1)]),
            cartera(card("NYSE:ACME.B")),
            none,
        );
        expect(findings).toEqual([]);
    });
});
