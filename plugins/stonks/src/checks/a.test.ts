import { describe, expect, it } from "vitest";

import type { IbkrRead, Position, SwsPortfolioRead } from "../domain.ts";
import { checkA } from "./a.ts";

const position = (ticker: string, quantity: number): Position => ({ ticker, quantity });

const ibkr = (positions: Position[] = []): IbkrRead => ({
    provenance: "mcp",
    positions,
    orders: [],
});

const sws = (...tickers: string[]): SwsPortfolioRead => ({
    tickers,
    links: [],
    count: tickers.length,
});

describe("checkA", () => {
    it("sold but still in the SWS portfolio: A2 for a listed ticker that is not held", () => {
        expect(checkA(sws("TYRL"), ibkr())).toEqual([
            {
                check: "A2",
                ticker: "TYRL",
                sides: { ibkr: "not held", "sws-portfolio": "listed" },
                severity: "discrepancy",
                affectsWatchlist: false,
            },
        ]);
    });

    it("different quantities: no A finding when both hold the ticker", () => {
        expect(checkA(sws("ACME"), ibkr([position("ACME", 2)]))).toEqual([]);
    });

    it("missing in SWS: A1 for a held ticker the portfolio does not list", () => {
        expect(checkA(sws(), ibkr([position("ACME", 2)]))).toEqual([
            {
                check: "A1",
                ticker: "ACME",
                sides: { ibkr: "holds 2", "sws-portfolio": "not listed" },
                severity: "discrepancy",
                affectsWatchlist: false,
            },
        ]);
    });

    it("excluded ticker missing from the SWS portfolio: A1 is still produced", () => {
        // Check A takes no Excluded tickers at all: the SWS portfolio mirrors IBKR fully.
        expect(checkA(sws("ACME"), ibkr([position("ACME", 2), position("ETFX", 10)]))).toEqual([
            expect.objectContaining({ check: "A1", ticker: "ETFX" }),
        ]);
    });

    it("treats a position of zero as not held", () => {
        expect(checkA(sws("TYRL"), ibkr([position("TYRL", 0)]))).toEqual([
            expect.objectContaining({ check: "A2", ticker: "TYRL" }),
        ]);
    });

    it("compares tickers by symbol, ignoring the exchange prefix and class separators", () => {
        const read = ibkr([position("ACME/B", 1), position("hool", 3)]);
        expect(checkA(sws("NYSE:ACME.B", "NasdaqGS:HOOL"), read)).toEqual([]);
    });

    it("reports both directions, A1 before A2", () => {
        expect(checkA(sws("TYRL"), ibkr([position("ACME", 1)])).map((item) => item.check)).toEqual([
            "A1",
            "A2",
        ]);
    });
});
