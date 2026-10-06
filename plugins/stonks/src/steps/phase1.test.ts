import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CONFIG_SCHEMA, type Directive, type Report, type RunMode } from "../domain.ts";
import type { RunnerResult } from "../inputs/sheet-gws.ts";
import { renderMarkdown } from "../report/markdown.ts";
import { SEARCH_URL } from "../report/links.ts";
import {
    beginRun,
    handoffPath,
    ibkrConfirmedPath,
    listingsPath,
    previousPath,
    rawDir,
    reauthOfferedPath,
    reportPath,
    runDir,
    writePrivate,
} from "../state.ts";
import { ibkrSteps } from "./ibkr.ts";
import { phase1Steps } from "./phase1.ts";
import type { StepContext, StepOutput } from "./types.ts";

const FIXTURES = join(import.meta.dirname, "fixtures", "phase1");
const INPUTS = join(import.meta.dirname, "..", "inputs", "fixtures");
const POSITIONS = "mcp__ibkr__get_account_positions";
const ORDERS = "mcp__ibkr__get_account_orders";

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));
const fixture = (name: string): unknown => readJson(join(FIXTURES, name));
const fixtureText = (name: string): string => readFileSync(join(FIXTURES, name), "utf8");
const hookResponse = (name: string): string =>
    (readJson(join(INPUTS, "ibkr", name)) as { tool_response: string }).tool_response;

const T0 = new Date("2026-10-05T08:00:00Z");
const T1 = new Date("2026-10-06T08:00:00Z");

let dir: string;
let stateDir: string;
let configPath: string;
let clock: number;

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "stonks-phase1-"));
    stateDir = join(dir, "state");
    configPath = join(dir, "config.json");
    clock = 0;
    writeFileSync(
        configPath,
        JSON.stringify({
            schema: CONFIG_SCHEMA,
            trackingSheet: { spreadsheetId: "sheet-id", tab: "Tab" },
            swsPortfolio: { url: "https://example.com/portfolio/1" },
            watchlist: { name: "Trader Picks", url: "https://example.com/watchlist" },
            carteraViva: { url: "https://example.com/cartera" },
            excludedTickers: ["ETFX"],
        }),
    );
});

afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
});

const open = (mode: RunMode = "full", now: Date = T0): string =>
    beginRun({ stateDir, mode, now }).runId;

const sheetOf = (values: unknown) => (): Promise<RunnerResult> =>
    Promise.resolve({ code: 0, stdout: JSON.stringify({ values }), stderr: "" });

function ctx(values: unknown = fixture("values-clean.json"), now: Date = T0): StepContext {
    return {
        env: { STONKS_CONFIG: configPath, STONKS_STATE_DIR: stateDir },
        now: () => now,
        sheetRunner: sheetOf(values),
    };
}

/** Writes a capture as the hook does: `raw/<15-digit ms>-<kind>.json`, newest last. */
function capture(runId: string, kind: string, text: string): string {
    clock += 1;
    const seq = String(T0.getTime() + clock).padStart(15, "0");
    const path = join(rawDir(stateDir, runId), `${seq}-${kind}.json`);
    writePrivate(path, text);
    return path;
}

const envelope = (name: string, run: string): string =>
    JSON.stringify({ ...(fixture(name) as Record<string, unknown>), run });

function captureIbkr(runId: string): void {
    capture(runId, POSITIONS, hookResponse("hook-positions.json"));
    capture(runId, ORDERS, hookResponse("hook-orders.json"));
}

function captureBrowser(
    runId: string,
    { sws = "sws-portfolio.json", cartera = "cartera-viva.json" } = {},
): void {
    capture(runId, "sws-portfolio", envelope(sws, runId));
    capture(runId, "cartera-viva", envelope(cartera, runId));
}

function captureAll(runId: string, options: { sws?: string; cartera?: string } = {}): void {
    captureIbkr(runId);
    captureBrowser(runId, options);
}

const STEPS = { ...phase1Steps, ...ibkrSteps };

function step(name: string, context: StepContext, args: string[] = []): Promise<StepOutput> {
    const entry = STEPS[name];
    if (entry === undefined) {
        throw new Error(`no step ${name}`);
    }
    return entry.step(context, args);
}

const report = (runId: string): Report =>
    JSON.parse(readFileSync(reportPath(stateDir, runId), "utf8")) as Report;

const findingsOf = (r: Report) => [...r.alerts, ...r.sections.flatMap((s) => s.findings)];

const keys = (r: Report): string[] =>
    findingsOf(r)
        .map((f) => `${f.check} ${f.ticker}`)
        .sort();

const reason = (directive: Directive): string =>
    directive.kind === "stop" ? directive.reason : "";

type Rows = (string | number)[][];

/** The clean sheet with the rows of `ticker` replaced. */
function withRows(ticker: string, ...rows: Rows): Rows {
    const values = fixture("values-clean.json") as Rows;
    return [...values.filter((row) => row[0] !== ticker), ...rows];
}

describe("phase1, gate", () => {
    it("prints every finding in one pause, the path line, and directs gate-wait", async () => {
        const runId = open();
        captureAll(runId, { sws: "sws-portfolio-without-hool.json" });
        const out = await step("phase1", ctx(fixture("values-gate.json")));
        expect(out.directive).toEqual({ kind: "gate-wait" });
        const written = report(runId);
        expect(keys(written)).toEqual([
            "A1 HOOL",
            "B2 ACME",
            "B3 GLBX",
            "C1 TYRL",
            "C4 CYBD",
            "C6 HOOL",
            "C9 VNDL",
        ]);
        expect(written.gate).toEqual({ tripped: true, affectedTickers: ["ACME", "TYRL"] });
        expect(out.markdown).toContain(renderMarkdown(written));
        expect(out.markdown).toContain("- [ ] B2 ACME");
        expect(out.markdown).toContain("- [ ] C1 TYRL");
        expect(out.markdown).toMatch(
            new RegExp(`^stonks-report-path: ${reportPath(stateDir, runId)}$`, "m"),
        );
        expect(out.markdown).toContain("`sigue`");
    });

    it("continues without asking when only a warning and informational findings remain", async () => {
        const runId = open();
        captureAll(runId);
        const out = await step("phase1", ctx());
        expect(out.directive).toEqual({ kind: "done" });
        const written = report(runId);
        expect(keys(written)).toEqual(["C4 CYBD", "C6 HOOL", "C9 VNDL"]);
        expect(new Set(findingsOf(written).map((f) => f.severity))).toEqual(
            new Set(["warning", "informational"]),
        );
        expect(written.gate.tripped).toBe(false);
        expect(out.markdown).toContain("`collector watchlist`");
        expect(out.markdown).toContain("`watchlist-plan`");
    });

    it("does not trip for a held Vender entry with its sell order", async () => {
        const runId = open();
        captureAll(runId);
        await step("phase1", ctx());
        const hool = findingsOf(report(runId)).filter((f) => f.ticker === "HOOL");
        expect(hool.map((f) => f.check)).toEqual(["C6"]);
    });

    it.each([
        { check: "B3 GLBX", values: withRows("GLBX", ["GLBX", "E", "Invertido", 4, 25.3]) },
        { check: "B6 CYBD", values: withRows("CYBD", ["CYBD", "S", "Comprar", 1, 40]) },
        {
            check: "B8 ACME",
            values: withRows(
                "ACME",
                ["ACME", "I", "Invertido", 1.5, 44.2],
                ["ACME", "I", "Vender", 1, 44.2],
            ),
        },
        { check: "A1 HOOL", sws: "sws-portfolio-without-hool.json" },
    ])("does not trip for $check alone", async ({ check, values, sws }) => {
        const runId = open();
        captureAll(runId, { sws });
        const out = await step("phase1", ctx(values ?? fixture("values-clean.json")));
        expect(out.directive).toEqual({ kind: "done" });
        const written = report(runId);
        expect(keys(written)).toContain(check);
        expect(written.gate.tripped).toBe(false);
    });

    it("ends after the report in --only sources, even when the gate trips", async () => {
        const runId = open("sources");
        captureAll(runId);
        const out = await step("phase1", ctx(fixture("values-gate.json")));
        expect(out.directive).toEqual({ kind: "done" });
        expect(report(runId).gate.tripped).toBe(true);
        expect(out.markdown).toContain("run `end`");
        expect(out.markdown).toContain("stonks-report-path: ");
    });

    it("does not run in --only watchlist", async () => {
        const runId = open("watchlist");
        captureAll(runId);
        const out = await step("phase1", ctx());
        expect(reason(out.directive)).toBe("phase 1 does not run in --only watchlist");
        expect(existsSync(reportPath(stateDir, runId))).toBe(false);
    });
});

describe("phase1, stop conditions", () => {
    it("stops naming the tracking sheet when gws is not authorised, with no report", async () => {
        const runId = open();
        captureAll(runId);
        const context: StepContext = {
            ...ctx(),
            sheetRunner: () =>
                Promise.resolve({ code: 1, stdout: "", stderr: "error[auth]: 401 unauthorized" }),
        };
        const out = await step("phase1", context);
        expect(out.directive.kind).toBe("stop");
        expect(reason(out.directive)).toContain("tracking sheet");
        expect(reason(out.directive)).toContain("not authorised");
        expect(existsSync(reportPath(stateDir, runId))).toBe(false);
    });

    it("stops naming the row and the value of an unknown Estado, with no report", async () => {
        const runId = open();
        captureAll(runId);
        const values = readJson(join(INPUTS, "sheet", "values-unknown-estado.json"));
        const out = await step("phase1", ctx(values));
        expect(out.directive.kind).toBe("stop");
        expect(reason(out.directive)).toContain("10");
        expect(reason(out.directive)).toContain("Invertida");
        expect(existsSync(reportPath(stateDir, runId))).toBe(false);
    });
});

describe("phase1, IBKR", () => {
    it("offers /mcp re-authentication first, and the fallback only on the next attempt", async () => {
        const runId = open();
        captureBrowser(runId);
        const first = await step("phase1", ctx());
        expect(first.directive).toEqual({ kind: "ibkr-reauth" });
        expect(first.markdown).toContain("IBKR could not be read: IBKR positions");
        expect(first.markdown).toContain("/mcp");
        expect(existsSync(reauthOfferedPath(stateDir, runId))).toBe(true);
        const second = await step("phase1", ctx());
        expect(second.directive).toEqual({ kind: "ibkr-fallback" });
        expect(second.markdown).toContain("did not restore the reads");
        expect(existsSync(reportPath(stateDir, runId))).toBe(false);
    });

    it.each([
        { failure: "no capture", positions: null, orders: null, names: "no capture" },
        {
            failure: "a login response",
            positions: "Unauthorized: session expired, please log in",
            orders: "Unauthorized: session expired, please log in",
            names: "asks for login",
        },
        {
            failure: "an order without a quantity",
            positions: hookResponse("hook-positions.json"),
            orders: readFileSync(join(INPUTS, "ibkr", "orders-missing-quantity.json"), "utf8"),
            names: "total_shares_qty",
        },
    ])(
        "never prints the fallback before the offer, for $failure",
        async ({ positions, orders, names }) => {
            const runId = open();
            captureBrowser(runId);
            if (positions !== null) {
                capture(runId, POSITIONS, positions);
            }
            if (orders !== null) {
                capture(runId, ORDERS, orders);
            }
            const out = await step("phase1", ctx());
            expect(out.directive).toEqual({ kind: "ibkr-reauth" });
            expect(out.markdown).toContain(names);
            expect(out.markdown).not.toContain("ibkr-screenshots-stage");
        },
    );

    it("continues through the MCP reads once the user has re-authenticated", async () => {
        const runId = open();
        captureBrowser(runId);
        expect((await step("phase1", ctx())).directive).toEqual({ kind: "ibkr-reauth" });
        captureIbkr(runId);
        const out = await step("phase1", ctx());
        expect(out.directive).toEqual({ kind: "done" });
        expect(report(runId).ibkr).toEqual({ provenance: "mcp", positions: 6, orders: 5 });
        expect(out.markdown).toContain("IBKR read through the MCP server");
    });

    it("uses the confirmed screenshot table and marks the report", async () => {
        const runId = open();
        captureBrowser(runId);
        await step("phase1", ctx());
        await step("phase1", ctx());
        const staged = await step("ibkr-screenshots-stage", {
            ...ctx(),
            stdin: fixtureText("screenshots.json"),
        });
        expect(staged.directive).toEqual({ kind: "done" });
        await step("ibkr-screenshots-confirm", ctx());
        expect(existsSync(ibkrConfirmedPath(stateDir, runId))).toBe(true);
        const out = await step("phase1", ctx());
        expect(out.directive).toEqual({ kind: "done" });
        expect(report(runId).ibkr).toEqual({ provenance: "screenshots", positions: 6, orders: 5 });
        expect(keys(report(runId))).toEqual(["C4 CYBD", "C6 HOOL", "C9 VNDL"]);
        expect(out.markdown).toContain("IBKR from user-confirmed screenshots");
    });

    it("never uses a staged table the user has not confirmed", async () => {
        const runId = open();
        captureBrowser(runId);
        await step("phase1", ctx());
        await step("ibkr-screenshots-stage", { ...ctx(), stdin: fixtureText("screenshots.json") });
        const out = await step("phase1", ctx());
        expect(out.directive).toEqual({ kind: "ibkr-fallback" });
        expect(existsSync(reportPath(stateDir, runId))).toBe(false);
    });

    it("carries an unknown-IBKR-tool warning into the report without changing the gate", async () => {
        const runId = open();
        captureAll(runId);
        await step("ibkr-tools", ctx(), [POSITIONS, ORDERS, "mcp__ibkr__submit_order"]);
        const out = await step("phase1", ctx());
        expect(out.directive).toEqual({ kind: "done" });
        expect(report(runId).warnings).toEqual([
            "mcp__ibkr__submit_order is not in the known set of IBKR tools; it was not called",
        ]);
        expect(out.markdown).toContain("WARNING: mcp__ibkr__submit_order");
        expect(keys(report(runId))).toEqual(["C4 CYBD", "C6 HOOL", "C9 VNDL"]);
    });
});

describe("phase1, browser reads", () => {
    it("asks for the SWS login on a login wall, and reads again once logged in", async () => {
        const runId = open();
        captureAll(runId, { sws: "sws-login-wall.json" });
        const out = await step("phase1", ctx());
        expect(out.directive).toEqual({ kind: "ask-login", source: "sws-portfolio" });
        expect(out.markdown).toContain("https://example.com/portfolio/1");
        expect(out.markdown).toContain("`collector sws-portfolio`");
        expect(existsSync(reportPath(stateDir, runId))).toBe(false);
        capture(runId, "sws-portfolio", envelope("sws-portfolio.json", runId));
        expect((await step("phase1", ctx())).directive).toEqual({ kind: "done" });
    });

    it("asks for the Cartera Viva login on a login wall", async () => {
        const runId = open();
        captureIbkr(runId);
        capture(runId, "sws-portfolio", envelope("sws-portfolio.json", runId));
        capture(
            runId,
            "cartera-viva",
            JSON.stringify({
                ...(readJson(join(INPUTS, "browser", "login-wall.json")) as object),
                run: runId,
            }),
        );
        const out = await step("phase1", ctx());
        expect(out.directive).toEqual({ kind: "ask-login", source: "cartera-viva" });
        expect(out.markdown).toContain("https://example.com/cartera");
        expect(out.markdown).toContain("`collector cartera-viva`");
    });

    it("stops naming the Cartera Viva and its collector when it was not read", async () => {
        const runId = open();
        captureIbkr(runId);
        capture(runId, "sws-portfolio", envelope("sws-portfolio.json", runId));
        const out = await step("phase1", ctx());
        expect(reason(out.directive)).toBe(
            "Cartera Viva: no read in this run; run `collector cartera-viva` through javascript_tool and run phase1 again",
        );
        expect(existsSync(reportPath(stateDir, runId))).toBe(false);
    });

    it("uses neither a stale run directory nor captures of another run (5.6)", async () => {
        const old = open("full", T0);
        captureAll(old);
        const runId = open("full", T1);
        expect(existsSync(runDir(stateDir, old))).toBe(false);
        // A stale directory of the old run, and the old run's results in this one.
        captureAll(old);
        captureIbkr(runId);
        for (const kind of ["sws-portfolio", "cartera-viva"]) {
            capture(runId, kind, envelope(`${kind}.json`, old));
        }
        const sws = await step("phase1", ctx(undefined, T1));
        expect(sws.directive.kind).toBe("stop");
        expect(reason(sws.directive)).toContain("SWS portfolio");
        expect(reason(sws.directive)).toContain(`belongs to run ${old}`);
        capture(runId, "sws-portfolio", envelope("sws-portfolio.json", runId));
        const cartera = await step("phase1", ctx(undefined, T1));
        expect(reason(cartera.directive)).toContain("Cartera Viva");
        expect(reason(cartera.directive)).toContain(`belongs to run ${old}`);
        expect(existsSync(reportPath(stateDir, runId))).toBe(false);
        expect(existsSync(reportPath(stateDir, old))).toBe(false);
    });
});

describe("phase1, links and listings", () => {
    it("links a ticker read in this run to its page and an unknown one to a search", async () => {
        const runId = open();
        captureAll(runId);
        await step("phase1", ctx());
        const { links } = report(runId);
        expect(links.HOOL).toBe(
            "https://simplywall.st/stocks/us/tech/nasdaqgs-hool/hoolihan-systems",
        );
        expect(links.CYBD).toBe(SEARCH_URL("CYBD"));
        const learnt = readJson(listingsPath(stateDir)) as Record<string, { symbol: string }>;
        expect(learnt.HOOL?.symbol).toBe("NasdaqGS:HOOL");
    });

    it("links a ticker learnt in an earlier run", async () => {
        writePrivate(
            listingsPath(stateDir),
            JSON.stringify({
                CYBD: {
                    symbol: "NasdaqGS:CYBD",
                    name: "Cyberdyne Systems",
                    url: "/stocks/us/tech/nasdaqgs-cybd/cyberdyne-systems",
                },
            }),
        );
        const runId = open();
        captureAll(runId);
        await step("phase1", ctx());
        expect(report(runId).links.CYBD).toBe("/stocks/us/tech/nasdaqgs-cybd/cyberdyne-systems");
    });

    it("reports an unreadable listings file as a warning", async () => {
        writePrivate(listingsPath(stateDir), "not json");
        const runId = open();
        captureAll(runId);
        await step("phase1", ctx());
        expect(report(runId).warnings).toEqual(["listings.json ignored: not valid JSON"]);
    });
});

describe("phase1, snapshot (7.6)", () => {
    it("writes only the new run's snapshot, and counts repeats from the handed-over one", async () => {
        const first = open("full", T0);
        captureAll(first);
        await step("phase1", ctx(undefined, T0));
        // The pane stores the snapshot and hands it over to the next run (design D14).
        writePrivate(handoffPath(stateDir), JSON.stringify(report(first).snapshot));

        const second = open("full", T1);
        const positions = JSON.parse(hookResponse("hook-positions.json")) as {
            positions: { contract_description: string }[];
        };
        positions.positions = positions.positions.filter((p) => p.contract_description !== "ETFX");
        capture(second, POSITIONS, JSON.stringify(positions));
        capture(second, ORDERS, hookResponse("hook-orders.json"));
        captureBrowser(second);
        await step("phase1", ctx(undefined, T1));

        const written = report(second);
        expect(existsSync(runDir(stateDir, first))).toBe(false);
        expect(written.snapshot.date).toBe(T1.toISOString());
        expect(written.snapshot.positions.map((p) => p.ticker)).not.toContain("ETFX");
        expect(written.movements.previousRunDate).toBe(T0.toISOString());
        expect(findingsOf(written).find((f) => f.check === "C6")?.repeat).toBe(2);
        expect(written.snapshot.findings).toContainEqual({
            check: "C6",
            ticker: "HOOL",
            repeat: 2,
        });
    });

    it("does not continue without IBKR even though a snapshot exists", async () => {
        writePrivate(
            handoffPath(stateDir),
            JSON.stringify({
                schema: "stonks.snapshot.v1",
                date: T0.toISOString(),
                positions: [{ ticker: "UMBR", quantity: 7 }],
                orders: [],
                findings: [],
            }),
        );
        const runId = open("full", T1);
        captureBrowser(runId);
        expect(existsSync(previousPath(stateDir, runId))).toBe(true);
        const first = await step("phase1", ctx(undefined, T1));
        expect(first.directive).toEqual({ kind: "ibkr-reauth" });
        const second = await step("phase1", ctx(undefined, T1));
        expect(second.directive).toEqual({ kind: "ibkr-fallback" });
        expect(first.markdown + second.markdown).not.toContain("UMBR");
        expect(existsSync(reportPath(stateDir, runId))).toBe(false);
    });

    it("ignores a snapshot of another schema, with a warning", async () => {
        writePrivate(
            handoffPath(stateDir),
            JSON.stringify({
                schema: "stonks.snapshot.v0",
                date: T0.toISOString(),
                positions: [],
                orders: [],
                findings: [],
            }),
        );
        const runId = open();
        captureAll(runId);
        await step("phase1", ctx());
        const written = report(runId);
        expect(written.movements.previousRunDate).toBeNull();
        expect(written.warnings).toEqual([
            "previous snapshot ignored: previous.schema must be stonks.snapshot.v1",
        ]);
    });
});

describe("sigue", () => {
    it("stops when phase 1 has not run in this run", async () => {
        const runId = open();
        captureAll(runId);
        const out = await step("sigue", ctx());
        expect(reason(out.directive)).toBe("phase 1 has not run in this run");
    });

    it("prints a remaining finding and directs done, never gate-wait", async () => {
        const runId = open();
        captureAll(runId);
        const gate = fixture("values-gate.json");
        expect((await step("phase1", ctx(gate))).directive).toEqual({ kind: "gate-wait" });
        const out = await step("sigue", ctx(gate));
        expect(out.directive).toEqual({ kind: "done" });
        expect(out.markdown).toContain("C1 ⚑");
        expect(out.markdown).toContain("- [ ] C1 TYRL");
        expect(out.markdown).toContain("does not pause again");
        expect(out.markdown).toContain("`watchlist-plan`");
        expect(report(runId).gate.tripped).toBe(true);
    });

    it("re-reads the sheet and recomputes with this run's captures", async () => {
        const runId = open();
        captureAll(runId);
        await step("phase1", ctx(fixture("values-gate.json")));
        let reads = 0;
        const fixed: StepContext = {
            ...ctx(),
            sheetRunner: () => {
                reads += 1;
                return sheetOf(fixture("values-clean.json"))();
            },
        };
        const out = await step("sigue", fixed);
        expect(reads).toBe(1);
        expect(out.directive).toEqual({ kind: "done" });
        expect(keys(report(runId))).toEqual(["C4 CYBD", "C6 HOOL", "C9 VNDL"]);
        expect(out.markdown).toMatch(/^stonks-report-path: /m);
    });

    it("stops when the IBKR captures can no longer be read", async () => {
        const runId = open();
        captureAll(runId);
        await step("phase1", ctx(fixture("values-gate.json")));
        rmSync(rawDir(stateDir, runId), { recursive: true });
        captureBrowser(runId);
        const out = await step("sigue", ctx());
        expect(out.directive.kind).toBe("stop");
        expect(reason(out.directive)).toContain("IBKR positions");
    });

    it("does not run in --only sources", async () => {
        const runId = open("sources");
        captureAll(runId);
        await step("phase1", ctx());
        expect((await step("sigue", ctx())).directive.kind).toBe("stop");
    });
});
