import { describe, expect, it } from "vitest";

import type {
    CheckId,
    Entry,
    Estado,
    IbkrRead,
    Finding,
    Position,
    ActiveOrder,
} from "../domain.ts";
import { finding } from "./findings.ts";
import { decideGate } from "./gate.ts";
import { runChecks } from "./index.ts";

const mark = (check: CheckId, ticker: string): Finding => finding(check, ticker, {});

const entry = (ticker: string, estado: Estado, cantidad: number): Entry => ({
    row: 2,
    ticker,
    estado,
    cantidad,
    pricePerUnit: null,
});

const position = (ticker: string, quantity: number): Position => ({ ticker, quantity });

const trailingSell = (ticker: string, quantity: number, trailPercent: number): ActiveOrder => ({
    ticker,
    side: "sell",
    quantity,
    orderType: "trailing-stop",
    limitPrice: null,
    trailPercent,
});

const ibkr = (positions: Position[], orders: ActiveOrder[] = []): IbkrRead => ({
    provenance: "mcp",
    positions,
    orders,
});

describe("decideGate", () => {
    it("trips on a watchlist-affecting finding and names its ticker", () => {
        expect(decideGate([mark("B1", "WNYE")])).toEqual({
            tripped: true,
            affectedTickers: ["WNYE"],
        });
    });

    it("lists the affected tickers sorted and without repeats", () => {
        const findings = [
            mark("C8", "WNYE"),
            mark("B1", "WNYE"),
            mark("C1", "UMBR"),
            mark("B3", "GLBX"),
            mark("C2", "CRUX"),
        ];
        expect(decideGate(findings)).toEqual({
            tripped: true,
            affectedTickers: ["CRUX", "UMBR", "WNYE"],
        });
    });

    it("does not trip on B3, B6, B8 and A findings alone", () => {
        const findings = [
            mark("A1", "ETFX"),
            mark("A2", "TYRL"),
            mark("B3", "GLBX"),
            mark("B6", "CYBD"),
            mark("B8", "STRK"),
        ];
        expect(decideGate(findings)).toEqual({ tripped: false, affectedTickers: [] });
    });

    it("does not trip on a run with only warnings, informational and not-evaluable findings", () => {
        const findings = [
            mark("C4", "HOOL"),
            mark("C5", "GLBX"),
            mark("C6", "INIT"),
            finding(
                "C6",
                "STRK",
                {},
                { notEvaluable: "the user's sell order is not a trailing stop" },
            ),
            mark("C9", "VNDL"),
        ];
        expect(decideGate(findings)).toEqual({ tripped: false, affectedTickers: [] });
    });

    it("does not trip on an empty run", () => {
        expect(decideGate([])).toEqual({ tripped: false, affectedTickers: [] });
    });

    it("vender still held with its stop: the whole run leaves the gate untripped", () => {
        const findings = runChecks({
            sheet: { entries: [entry("STRK", "Vender", 3)] },
            ibkr: ibkr([position("STRK", 3)], [trailingSell("STRK", 3, 10)]),
            sws: { tickers: ["STRK"], links: [], count: 1 },
            carteraViva: { cards: [] },
            excludedTickers: [],
        });
        expect(findings).toEqual([]);
        expect(decideGate(findings)).toEqual({ tripped: false, affectedTickers: [] });
    });

    it("trips on a run whose only Discrepancy is a B2, and not on an Excluded one", () => {
        const inputs = {
            sheet: { entries: [] },
            ibkr: ibkr([position("HOOL", 2), position("ETFX", 10)]),
            sws: { tickers: ["HOOL", "ETFX"], links: [], count: 2 },
            carteraViva: { cards: [] },
            excludedTickers: ["etfx"],
        };
        expect(decideGate(runChecks(inputs))).toEqual({ tripped: true, affectedTickers: ["HOOL"] });
    });
});
