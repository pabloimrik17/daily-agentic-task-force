// Spike stub (task 1.3): stands in for the engine's `phase1` step. It writes a
// fictional `report.json` into the state directory and prints the markdown
// the way the real step will, with both candidate feeds for the pane: the
// `stonks-report-path:` line and the inlined JSON block. Deleted in task 1.8.
//
//   STONKS_STATE_DIR=/tmp/x bun plugins/stonks/src/spike-stub.ts spike-report
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const stateDir =
    process.env.STONKS_STATE_DIR ??
    join(
        process.env.XDG_STATE_HOME ?? join(process.env.HOME ?? "/tmp", ".local", "state"),
        "stonks",
    );
const runId = `spike-${new Date().toISOString().slice(0, 19).replace(/[-:]/g, "")}`;
const runDir = join(stateDir, "runs", runId);
mkdirSync(runDir, { recursive: true, mode: 0o700 });

const sws = "https://simplywall.st/stocks/us/software/nasdaq-hool/hool";
const links: Record<string, string> = {
    HOOL: sws,
    ACME: "https://simplywall.st/stocks/us/capital-goods/nyse-acme/acme",
    STRK: "https://simplywall.st/stocks/us/tech/nasdaq-strk/strk",
    GLBX: "https://simplywall.st/stocks/us/retail/nyse-glbx/glbx",
    INIT: "https://simplywall.st/stocks/us/semis/nasdaq-init/init",
    CRUX: "https://simplywall.st/search?q=CRUX",
    WNYE: "https://simplywall.st/search?q=WNYE",
    TYRL: "https://simplywall.st/search?q=TYRL",
    UMBR: "https://simplywall.st/search?q=UMBR",
    CYBD: "https://simplywall.st/search?q=CYBD",
    VNDL: "https://simplywall.st/search?q=VNDL",
};

const report = {
    schema: "stonks.report.v1",
    runId,
    generatedAt: new Date().toISOString(),
    ibkr: { provenance: "mcp", positions: 21, orders: 13 },
    counts: { swsPortfolio: 21, carteraViva: 18 },
    warnings: ["mcp__ibkr__submit_order is not in the known set of IBKR tools (fictional)"],
    alerts: [
        {
            check: "B8",
            ticker: "STRK",
            sides: { ibkr: "holds 3, sell orders cover 2", "tracking-sheet": "Vender 3" },
            severity: "alert",
            affectsWatchlist: false,
            repeat: 2,
        },
    ],
    sections: [
        {
            mirror: "sws-portfolio",
            findings: [
                {
                    check: "A2",
                    ticker: "TYRL",
                    sides: { "sws-portfolio": "listed", ibkr: "not held" },
                    severity: "discrepancy",
                    affectsWatchlist: false,
                    repeat: 1,
                },
            ],
        },
        {
            mirror: "tracking-sheet",
            findings: [
                {
                    check: "B1",
                    ticker: "WNYE",
                    sides: { "tracking-sheet": "Vender 3", ibkr: "not held, no order" },
                    severity: "discrepancy",
                    affectsWatchlist: true,
                    repeat: 1,
                },
                {
                    check: "B3",
                    ticker: "GLBX",
                    sides: { ibkr: "holds 2", "tracking-sheet": "position 1" },
                    severity: "discrepancy",
                    affectsWatchlist: false,
                    repeat: 3,
                },
                {
                    check: "B6",
                    ticker: "CYBD",
                    sides: { "tracking-sheet": "Comprar 1 @ 42.00", ibkr: "buy 1 limit 41.50" },
                    severity: "discrepancy",
                    affectsWatchlist: false,
                    repeat: 1,
                },
            ],
        },
        {
            mirror: "cartera-viva",
            findings: [
                {
                    check: "C1",
                    ticker: "UMBR",
                    sides: { "tracking-sheet": "Roger", "cartera-viva": "not listed" },
                    severity: "discrepancy",
                    affectsWatchlist: true,
                    repeat: 1,
                },
                {
                    check: "C2",
                    ticker: "CRUX",
                    sides: {
                        "cartera-viva": "listed",
                        "tracking-sheet": "no entry",
                        ibkr: "not held",
                    },
                    severity: "discrepancy",
                    affectsWatchlist: true,
                    repeat: 1,
                },
                {
                    check: "C6",
                    ticker: "INIT",
                    sides: { "cartera-viva": "trailing 10%", ibkr: "trailing 15%" },
                    severity: "warning",
                    affectsWatchlist: false,
                    repeat: 3,
                },
                {
                    check: "C9",
                    ticker: "VNDL",
                    sides: { ibkr: "buy order live", "cartera-viva": "not listed" },
                    severity: "informational",
                    affectsWatchlist: false,
                    repeat: 1,
                },
            ],
        },
    ],
    movements: {
        previousRunDate: "2026-10-03T20:11:00Z",
        items: [
            { kind: "triggered-sell", ticker: "WNYE", quantity: 3, side: "sell" },
            { kind: "fill", ticker: "HOOL", quantity: 2, side: "buy" },
            { kind: "cancelled-order", ticker: "VNDL", quantity: 1, side: "buy" },
        ],
    },
    gate: { tripped: true, affectedTickers: ["WNYE", "UMBR", "CRUX"] },
    links,
    snapshot: {
        schema: "stonks.snapshot.v1",
        date: new Date().toISOString(),
        positions: [
            { ticker: "HOOL", quantity: 2 },
            { ticker: "STRK", quantity: 3 },
            { ticker: "GLBX", quantity: 2 },
        ],
        orders: [
            {
                ticker: "STRK",
                side: "sell",
                quantity: 2,
                orderType: "trailing-stop",
                limitPrice: null,
                trailPercent: 15,
            },
        ],
        findings: [
            { check: "B8", ticker: "STRK", repeat: 2 },
            { check: "B3", ticker: "GLBX", repeat: 3 },
            { check: "C6", ticker: "INIT", repeat: 3 },
        ],
    },
};

const reportPath = join(runDir, "report.json");
writeFileSync(reportPath, JSON.stringify(report, null, 2), { mode: 0o600 });

const lines: string[] = [
    "# Stonks · phase 1 (fictional spike report)",
    "",
    "## Alerts",
    "",
    "- **B8 Unprotected position** [STRK](" +
        links.STRK +
        "): IBKR holds 3, sell orders cover 2; Vender 3 (×2)",
    "",
    "## SWS portfolio",
    "",
    "- A2 [TYRL](" + links.TYRL + "): listed in SWS, not held",
    "",
    "## Tracking sheet",
    "",
    "- B1 ⚑ [WNYE](" + links.WNYE + "): Vender 3; not held, no order",
    "- B3 [GLBX](" + links.GLBX + "): holds 2; position 1 (×3)",
    "- B6 [CYBD](" + links.CYBD + "): Comprar 1 @ 42.00; buy 1 limit 41.50",
    "",
    "## Cartera Viva",
    "",
    "- C1 ⚑ [UMBR](" + links.UMBR + "): Roger; not listed",
    "- C2 ⚑ [CRUX](" + links.CRUX + "): listed; no entry; not held",
    "- C6 warning [INIT](" + links.INIT + "): trailing 10% vs 15% (×3)",
    "- C9 info [VNDL](" + links.VNDL + "): buy order live; not listed",
    "",
    "## Movimientos since 2026-10-03T20:11:00Z",
    "",
    "- triggered sell 3 WNYE",
    "- fill 2 HOOL",
    "- cancelled order 1 VNDL (buy)",
    "",
    "## Gate: tripped (WNYE, UMBR, CRUX)",
    "",
    "- [ ] B1 WNYE",
    "- [ ] C1 UMBR",
    "- [ ] C2 CRUX",
    "",
    `stonks-report-path: ${reportPath}`,
    "",
    "<!-- stonks-report-json -->",
    JSON.stringify(report),
    "<!-- /stonks-report-json -->",
    "",
    'directive: {"kind":"gate-wait"}',
];
process.stdout.write(lines.join("\n") + "\n");
