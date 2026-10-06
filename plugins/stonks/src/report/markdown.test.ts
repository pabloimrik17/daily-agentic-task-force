import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { decideGate } from "../checks/gate.ts";
import { type CheckInputs, runChecks } from "../checks/index.ts";
import type { Finding, Report } from "../domain.ts";
import { withRepeatCounts } from "./counters.ts";
import { tickerLinks } from "./links.ts";
import { BLOCK_LIMIT, renderMarkdown, renderSections } from "./markdown.ts";
import { buildReport } from "./model.ts";

const finding = (
    check: Finding["check"],
    ticker: string,
    overrides: Partial<Finding> = {},
): Finding => ({
    check,
    ticker,
    sides: {},
    severity: "discrepancy",
    affectsWatchlist: false,
    repeat: 1,
    ...overrides,
});

const fictional: Report = {
    schema: "stonks.report.v1",
    runId: "20261004T100000",
    generatedAt: "2026-10-04T10:00:00Z",
    ibkr: { provenance: "mcp", positions: 21, orders: 13 },
    counts: { swsPortfolio: 21, carteraViva: 18 },
    warnings: ["mcp__ibkr__submit_order is not in the known set of IBKR tools (fictional)"],
    alerts: [
        finding("B8", "STRK", {
            severity: "alert",
            repeat: 2,
            sides: { ibkr: "holds 3, sell orders cover 2", "tracking-sheet": "Vender 3" },
        }),
    ],
    sections: [
        {
            mirror: "sws-portfolio",
            findings: [
                finding("A2", "TYRL", { sides: { "sws-portfolio": "listed", ibkr: "not held" } }),
            ],
        },
        {
            mirror: "tracking-sheet",
            findings: [
                finding("B1", "WNYE", {
                    affectsWatchlist: true,
                    sides: { "tracking-sheet": "Vender 3", ibkr: "not held | no order" },
                }),
                finding("B3", "GLBX", {
                    repeat: 3,
                    sides: { ibkr: "holds 2", "tracking-sheet": "position 1" },
                }),
            ],
        },
        {
            mirror: "cartera-viva",
            findings: [
                finding("C2", "CRUX", {
                    affectsWatchlist: true,
                    sides: { "cartera-viva": "listed" },
                }),
                finding("C6", "INIT", {
                    severity: "warning",
                    repeat: 3,
                    sides: { "cartera-viva": "trailing 10%" },
                }),
                finding("C9", "VNDL", {
                    severity: "not-evaluable",
                    reason: "order side unreadable",
                }),
            ],
        },
    ],
    movements: {
        previousRunDate: "2026-10-03T20:11:00Z",
        items: [
            { kind: "triggered-sell", ticker: "WNYE", quantity: 3, side: "sell" },
            { kind: "fill", ticker: "HOOL", quantity: 2, side: "buy" },
            { kind: "new-order", ticker: "ACME", quantity: 1, side: "sell" },
            { kind: "cancelled-order", ticker: "VNDL", quantity: 1, side: "buy" },
        ],
    },
    gate: { tripped: true, affectedTickers: ["WNYE", "CRUX"] },
    links: {
        STRK: "https://simplywall.st/stocks/us/tech/nasdaq-strk/strk",
        WNYE: "https://simplywall.st/search?q=WNYE",
    },
    watchlist: {
        removed: ["WNYE"],
        added: ["CRUX"],
        unresolved: ["UMBR"],
        final: ["CRUX", "HOOL"],
        count: 2,
        capacity: 50,
        incomplete: { missing: ["UMBR"], extra: [] },
    },
    snapshot: {
        schema: "stonks.snapshot.v1",
        date: "2026-10-04T10:00:00Z",
        positions: [],
        orders: [],
        findings: [],
    },
};

describe("renderMarkdown", () => {
    it("renders a fictional report", () => {
        expect(renderMarkdown(fictional)).toMatchSnapshot();
    });

    it("states that a mirror agrees and that there is no previous run", () => {
        const md = renderMarkdown({
            ...fictional,
            alerts: [],
            sections: fictional.sections.map((s) => ({ ...s, findings: [] })),
            movements: { previousRunDate: null, items: [] },
            gate: { tripped: false, affectedTickers: [] },
            watchlist: null,
            warnings: [],
            ibkr: { provenance: "screenshots", positions: 1, orders: 0 },
        });
        // The SWS portfolio and the tracking sheet are compared with IBKR, the C
        // checks compare the tracking sheet with the Cartera Viva.
        expect(md.match(/Agrees with IBKR\./g)).toHaveLength(2);
        expect(md).toContain("## Cartera Viva\n\nThe tracking sheet agrees with the Cartera Viva.");
        expect(md).toContain("No previous run to compare with.");
        expect(md).toContain("IBKR from user-confirmed screenshots");
        expect(md).not.toContain("## Gate");
        expect(md).not.toContain("## Watchlist");
    });

    it("lists alerts before the sections and checklists only findings affecting the watchlist", () => {
        const md = renderMarkdown(fictional);
        expect(md.indexOf("## Alerts")).toBeLessThan(md.indexOf("## SWS portfolio"));
        expect(md).toContain("- [ ] B1 [WNYE](");
        expect(md).toContain("- [ ] C2 CRUX");
        expect(md).not.toContain("- [ ] B3");
        expect(md).toContain("B1 ⚑");
        expect(md).toContain("not evaluable: order side unreadable");
        expect(md).toContain("[STRK](https://simplywall.st/stocks/us/tech/nasdaq-strk/strk)");
    });
});

describe("renderSections", () => {
    it("truncates a long block but renderMarkdown keeps every row", () => {
        const many = Array.from({ length: 400 }, (_, i) =>
            finding("B3", `T${i}`, { sides: { ibkr: "x".repeat(60) } }),
        );
        const big: Report = {
            ...fictional,
            sections: [{ mirror: "tracking-sheet", findings: many }],
        };
        const block = renderSections(big).sections["tracking-sheet"];
        expect(block.length).toBeLessThanOrEqual(BLOCK_LIMIT);
        expect(block).toMatch(/\n… \d+ more, see the markdown report$/);
        expect(renderMarkdown(big)).toContain("T399");
    });

    it("leaves a short block whole and the checklist empty when the gate is open", () => {
        const parts = renderSections({
            ...fictional,
            gate: { tripped: false, affectedTickers: [] },
        });
        expect(parts.checklist).toBe("");
        expect(parts.alerts).toContain("STRK");
        expect(parts.movements).toContain("triggered sell 3 [WNYE](");
    });
});

describe("golden dataset", () => {
    const inputs = JSON.parse(
        readFileSync(new URL("../checks/fixtures/golden/inputs.json", import.meta.url), "utf8"),
    ) as CheckInputs;
    // Built as the engine builds it.
    const found = runChecks(inputs);
    const gate = decideGate(found);
    const findings = withRepeatCounts(found, null);
    const links = tickerLinks(
        findings.map((f) => f.ticker),
        { runLinks: inputs.sws.links, listings: {} },
    );
    const report = buildReport({
        runId: "20261004T100000Z-abcdef",
        generatedAt: "2026-10-04T10:00:00Z",
        ibkr: inputs.ibkr,
        swsCount: inputs.sws.count,
        carteraVivaCount: inputs.carteraViva.cards.length,
        warnings: [],
        findings,
        gate,
        previous: null,
        links,
        watchlist: null,
    });
    const md = renderMarkdown(report);

    it("renders the golden report", () => {
        expect(md).toMatchSnapshot();
    });

    it("leads with the alerts, B8 first", () => {
        expect(report.alerts.length).toBeGreaterThan(0);
        expect(md.indexOf("## Alerts")).toBeLessThan(md.indexOf("## SWS portfolio"));
        const alertRows = md
            .slice(md.indexOf("## Alerts"), md.indexOf("## SWS portfolio"))
            .split("\n")
            .filter((line) => line.startsWith("| B"));
        expect(alertRows[0]).toMatch(/^\| B8 /);
    });

    it("follows with SWS portfolio, Tracking sheet and Cartera Viva, in that order", () => {
        const at = ["## SWS portfolio", "## Tracking sheet", "## Cartera Viva"].map((h) =>
            md.indexOf(h),
        );
        expect(at.every((i) => i >= 0)).toBe(true);
        expect(at).toEqual([...at].sort((a, b) => a - b));
        expect(md.indexOf("## Alerts")).toBeLessThan(at[0] ?? -1);
    });

    it("says there is no previous run", () => {
        expect(md).toContain("## Movimientos\n\nNo previous run to compare with.");
    });

    it("checklists exactly the watchlist-affecting findings when the gate trips", () => {
        expect(gate.tripped).toBe(true);
        const expected = findings
            .filter((f) => f.affectsWatchlist)
            .map((f) => `- [ ] ${f.check} [${f.ticker}](${links[f.ticker] ?? ""})`)
            .sort();
        const listed = md
            .split("\n")
            .filter((line) => line.startsWith("- [ ] "))
            .sort();
        expect(expected.length).toBeGreaterThan(0);
        expect(listed).toEqual(expected);
    });

    it("keeps every pane block within the limit", () => {
        const parts = renderSections(report);
        const blocks = [
            parts.alerts,
            ...Object.values(parts.sections),
            parts.movements,
            parts.checklist,
        ];
        for (const text of blocks) {
            expect(text.length).toBeLessThanOrEqual(BLOCK_LIMIT);
        }
    });
});
