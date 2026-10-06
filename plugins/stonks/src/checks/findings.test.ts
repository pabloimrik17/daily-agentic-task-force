import { describe, expect, it } from "vitest";

import type { ActiveOrder, CheckId, Entry, Estado, IbkrRead, Position } from "../domain.ts";
import { normaliseTicker, samePrice, sameQuantity } from "../ticker.ts";
import {
    AFFECTS_WATCHLIST,
    SEVERITY_OF,
    entriesByTicker,
    finding,
    formatPercent,
    formatPrice,
    formatQuantity,
    heldQuantity,
    heldTickers,
    ibkrTickers,
    liveOrders,
    sheetPosition,
} from "./findings.ts";

const entry = (ticker: string, estado: Estado, cantidad: number, row = 2): Entry => ({
    row,
    ticker,
    estado,
    cantidad,
    pricePerUnit: null,
});

const position = (ticker: string, quantity: number): Position => ({ ticker, quantity });

const order = (ticker: string, side: ActiveOrder["side"], quantity: number): ActiveOrder => ({
    ticker,
    side,
    quantity,
    orderType: "limit",
    limitPrice: null,
    trailPercent: null,
});

const ibkr = (positions: Position[] = [], orders: ActiveOrder[] = []): IbkrRead => ({
    provenance: "mcp",
    positions,
    orders,
});

const EVERY_CHECK: CheckId[] = [
    "A1",
    "A2",
    "B1",
    "B2",
    "B3",
    "B4",
    "B5",
    "B6",
    "B7",
    "B8",
    "C1",
    "C2",
    "C3",
    "C4",
    "C5",
    "C6",
    "C7",
    "C8",
    "C9",
];

describe("finding", () => {
    it("informational finding: C4 is informational and does not affect the watchlist", () => {
        expect(finding("C4", "ACME", {})).toEqual({
            check: "C4",
            ticker: "ACME",
            sides: {},
            severity: "informational",
            affectsWatchlist: false,
        });
    });

    it("unprotected position: B8 is an alert and does not affect the watchlist", () => {
        expect(finding("B8", "STRK", {})).toMatchObject({
            severity: "alert",
            affectsWatchlist: false,
        });
    });

    it("quantity or price mismatch: B3 and B6 are Discrepancies that do not affect the watchlist", () => {
        for (const check of ["B3", "B6"] as const) {
            expect(finding(check, "GLBX", {})).toMatchObject({
                severity: "discrepancy",
                affectsWatchlist: false,
            });
        }
    });

    it("marks exactly B1, B2, B4, B5, B7, C1, C2, C3, C7 and C8 as affecting the watchlist", () => {
        expect([...AFFECTS_WATCHLIST].sort()).toEqual([
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
        for (const check of EVERY_CHECK) {
            expect(finding(check, "ACME", {}).affectsWatchlist).toBe(AFFECTS_WATCHLIST.has(check));
        }
    });

    it("classifies every check: B8 the only alert, C5 and C6 warnings, C4 and C9 informational", () => {
        const bySeverity = (severity: string): CheckId[] =>
            EVERY_CHECK.filter((check) => SEVERITY_OF[check] === severity);
        expect(bySeverity("alert")).toEqual(["B8"]);
        expect(bySeverity("warning")).toEqual(["C5", "C6"]);
        expect(bySeverity("informational")).toEqual(["C4", "C9"]);
        expect(bySeverity("not-evaluable")).toEqual([]);
        expect(bySeverity("discrepancy")).toEqual([
            "A1",
            "A2",
            "B1",
            "B2",
            "B3",
            "B4",
            "B5",
            "B6",
            "B7",
            "C1",
            "C2",
            "C3",
            "C7",
            "C8",
        ]);
    });

    it("produces C6 as not evaluable with its reason, never affecting the watchlist", () => {
        expect(
            finding("C6", "INIT", { ibkr: "stop" }, { notEvaluable: "not a trailing stop" }),
        ).toEqual({
            check: "C6",
            ticker: "INIT",
            sides: { ibkr: "stop" },
            severity: "not-evaluable",
            affectsWatchlist: false,
            reason: "not a trailing stop",
        });
    });
});

describe("sheetPosition", () => {
    it("several entries make one position", () => {
        const entries = [entry("INIT", "Invertido", 2), entry("INIT", "Vender", 1, 3)];
        expect(sheetPosition(entries)).toBe(3);
    });

    it("counts only Invertido and Vender", () => {
        const entries = [
            entry("INIT", "Invertido", 2),
            entry("INIT", "Comprar", 5, 3),
            entry("INIT", "Roger", 7, 4),
            entry("INIT", "Operativa", 11, 5),
            entry("INIT", "En espera", 13, 6),
        ];
        expect(sheetPosition(entries)).toBe(2);
    });

    it("compares fractional quantities numerically", () => {
        const entries = [entry("INIT", "Invertido", 0.1), entry("INIT", "Vender", 0.2, 3)];
        expect(sameQuantity(sheetPosition(entries), 0.3)).toBe(true);
    });
});

describe("heldQuantity", () => {
    it("sums the positions above zero and ignores the rest", () => {
        const read = ibkr([position("ACME", 2), position("ACME", 0.5), position("HOOL", 0)]);
        expect(heldQuantity(read, "ACME")).toBe(2.5);
        expect(heldQuantity(read, "HOOL")).toBe(0);
        expect(heldTickers(read)).toEqual(new Set(["ACME"]));
    });

    it("meets the ticker through every separator and exchange prefix", () => {
        const read = ibkr([position("NYSE:ACME/B", 1), position("acme b", 1)]);
        expect(heldQuantity(read, "ACME.B")).toBe(2);
        expect(heldTickers(read)).toEqual(new Set(["ACME.B"]));
    });
});

describe("entriesByTicker", () => {
    it("groups by normalised ticker in row order", () => {
        const grouped = entriesByTicker({
            entries: [
                entry("acme.b", "Invertido", 1, 2),
                entry("HOOL", "Roger", 0, 3),
                entry("NYSE:ACME/B", "Vender", 1, 4),
            ],
        });
        expect([...grouped.keys()]).toEqual(["ACME.B", "HOOL"]);
        expect(grouped.get("ACME.B")?.map((item) => item.row)).toEqual([2, 4]);
    });
});

describe("liveOrders and ibkrTickers", () => {
    it("selects the side on the ticker and names every ticker IBKR mentions", () => {
        const read = ibkr(
            [position("ACME", 1)],
            [order("acme", "buy", 1), order("ACME", "sell", 1), order("VNDL", "buy", 1)],
        );
        expect(liveOrders(read, "ACME", "buy")).toEqual([order("acme", "buy", 1)]);
        expect(liveOrders(read, "ACME", "sell")).toEqual([order("ACME", "sell", 1)]);
        expect(ibkrTickers(read)).toEqual(new Set(["ACME", "VNDL"]));
    });
});

describe("D16 comparisons", () => {
    it("ticker separators: dot, slash, space and an exchange prefix meet as one symbol", () => {
        for (const raw of ["acme.b", "ACME/B", "ACME B", "NasdaqGS:ACME.B", " acme/b "]) {
            expect(normaliseTicker(raw)).toBe("ACME.B");
        }
    });

    it("fractional quantities: equal below 1e-6, different above", () => {
        expect(sameQuantity(0.1 + 0.2, 0.3)).toBe(true);
        expect(sameQuantity(1.5, 1.50001)).toBe(false);
        expect(formatQuantity(0.1 + 0.2)).toBe("0.3");
    });

    it("price rounding: prices meet at four decimals", () => {
        expect(samePrice(42, 42.00004)).toBe(true);
        expect(samePrice(42, 42.0001)).toBe(false);
        expect(formatPrice(42)).toBe("42.00");
        expect(formatPrice(41.5)).toBe("41.50");
        expect(formatPrice(41.50249)).toBe("41.5025");
        expect(formatPercent(10)).toBe("10%");
        expect(formatPercent(12.5)).toBe("12.5%");
    });
});
