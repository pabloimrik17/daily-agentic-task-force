import { describe, expect, it } from "vitest";

import type { Finding, IbkrRead } from "../domain.ts";
import { buildReport, type ReportInput } from "./model.ts";

const finding = (check: Finding["check"], ticker: string, repeat = 1): Finding => ({
    check,
    ticker,
    sides: {},
    severity: "discrepancy",
    affectsWatchlist: false,
    repeat,
});

const ibkr: IbkrRead = {
    provenance: "mcp",
    positions: [{ ticker: "ACME", quantity: 2 }],
    orders: [],
};

const input = (findings: Finding[]): ReportInput => ({
    runId: "r1",
    generatedAt: "2026-10-04T10:00:00Z",
    ibkr,
    swsCount: 5,
    carteraVivaCount: 4,
    warnings: [],
    findings,
    gate: { tripped: false, affectedTickers: [] },
    previous: null,
    links: {},
    watchlist: null,
});

describe("buildReport", () => {
    it("puts every B8 first, ordered by ticker, even when other findings sort before it", () => {
        const report = buildReport(
            input([
                finding("A1", "ACME"),
                finding("B8", "STRK"),
                finding("B3", "ACME"),
                finding("B8", "HOOL"),
            ]),
        );
        expect(report.alerts.map((f) => f.ticker)).toEqual(["HOOL", "STRK"]);
        expect(report.sections.flatMap((s) => s.findings).some((f) => f.check === "B8")).toBe(
            false,
        );
    });

    it("orders sections SWS portfolio, tracking sheet, Cartera Viva", () => {
        const report = buildReport(
            input([finding("C1", "ACME"), finding("B1", "ACME"), finding("A2", "ACME")]),
        );
        expect(report.sections.map((s) => [s.mirror, s.findings.map((f) => f.check)])).toEqual([
            ["sws-portfolio", ["A2"]],
            ["tracking-sheet", ["B1"]],
            ["cartera-viva", ["C1"]],
        ]);
    });

    it("yields an empty findings list for a mirror that agrees", () => {
        const report = buildReport(input([finding("B1", "ACME")]));
        expect(report.sections.find((s) => s.mirror === "sws-portfolio")?.findings).toEqual([]);
    });

    it("snapshots every finding including alerts, and the previous run date", () => {
        const report = buildReport({
            ...input([finding("B8", "STRK", 2), finding("C6", "INIT", 3)]),
            previous: {
                schema: "stonks.snapshot.v1",
                date: "2026-10-03T20:11:00Z",
                positions: [],
                orders: [],
                findings: [],
            },
        });
        expect(report.snapshot).toEqual({
            schema: "stonks.snapshot.v1",
            date: "2026-10-04T10:00:00Z",
            positions: ibkr.positions,
            orders: [],
            findings: [
                { check: "B8", ticker: "STRK", repeat: 2 },
                { check: "C6", ticker: "INIT", repeat: 3 },
            ],
        });
        expect(report.movements.previousRunDate).toBe("2026-10-03T20:11:00Z");
        expect(report.ibkr).toEqual({ provenance: "mcp", positions: 1, orders: 0 });
    });
});
