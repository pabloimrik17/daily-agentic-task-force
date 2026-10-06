import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CONFIG_SCHEMA, type Directive, REPORT_SCHEMA, type Report } from "../domain.ts";
import { renderMarkdown } from "../report/markdown.ts";
import {
    beginRun,
    listingsPath,
    planPath,
    rawDir,
    reportPath,
    resumedPath,
    writePrivate,
} from "../state.ts";
import type { RunnerResult } from "../inputs/sheet-gws.ts";
import type { RunMode } from "../domain.ts";
import { browserSteps } from "./browser.ts";
import { type StepContext, UsageError } from "./types.ts";
import { watchlistSteps } from "./watchlist.ts";

const FIXTURES = join(import.meta.dirname, "fixtures", "watchlist");
const fixture = (name: string): Record<string, unknown> =>
    JSON.parse(readFileSync(join(FIXTURES, name), "utf8")) as Record<string, unknown>;

let dir: string;
let stateDir: string;
let runId: string;
let clock: number;

const NOW = new Date("2026-10-04T21:19:00Z");

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "stonks-watchlist-"));
    stateDir = join(dir, "state");
    clock = 1_000_000;
});

afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
});

function open(mode: RunMode = "full", values: unknown = fixture("values.json")) {
    const configPath = join(dir, "config.json");
    writeFileSync(
        configPath,
        JSON.stringify({
            schema: CONFIG_SCHEMA,
            trackingSheet: { spreadsheetId: "sheet-id", tab: "Tab" },
            swsPortfolio: { url: "https://example.com/portfolio/1" },
            watchlist: { name: "Trader Picks", url: "https://example.com/watchlist" },
            carteraViva: { url: "https://example.com/cartera" },
            excludedTickers: ["AAA"],
        }),
    );
    ({ runId } = beginRun({ stateDir, mode, now: NOW }));
    if (mode === "full") {
        // A full run reaches phase 2 through phase 1, whose gate stayed open here.
        writePrivate(reportPath(stateDir, runId), JSON.stringify(reportWith(null)));
    }
    const result: RunnerResult = { code: 0, stdout: JSON.stringify({ values }), stderr: "" };
    const ctx: StepContext = {
        env: { STONKS_CONFIG: configPath, STONKS_STATE_DIR: stateDir },
        now: () => NOW,
        sheetRunner: () => Promise.resolve(result),
    };
    return ctx;
}

/** Writes a capture as the hook would: `raw/<15-digit ms>-<kind>.json`, newest last. */
function capture(kind: string, body: Record<string, unknown>): string {
    clock += 1;
    const path = join(rawDir(stateDir, runId), `${String(clock).padStart(15, "0")}-${kind}.json`);
    writePrivate(path, JSON.stringify({ ...body, run: runId }));
    return path;
}

interface Row {
    href: string;
    text: string;
    uniqueSymbol: string | null;
}

const ROWS: Record<string, Row> = {
    ACME: {
        href: "/stocks/us/software/nyse-acme/acme-corp",
        text: "Acme Corp",
        uniqueSymbol: "NYSE:ACME",
    },
    HOOL: {
        href: "/stocks/us/tech/nasdaqgs-hool/hoolihan-systems",
        text: "Hoolihan Systems",
        uniqueSymbol: "NasdaqGS:HOOL",
    },
    CRUX: {
        href: "/stocks/us/tech/nasdaq-crux/cruxwell",
        text: "Cruxwell",
        uniqueSymbol: null,
    },
    GLBX: {
        href: "/stocks/us/energy/nyse-glbx/globex-energy",
        text: "GLBX",
        uniqueSymbol: null,
    },
    STRK: {
        href: "/stocks/us/materials/nyse-strk/strike-metals",
        text: "Strike Metals",
        uniqueSymbol: "NYSE:STRK",
    },
};

function watchlist(tickers: string[], counter?: string): Record<string, unknown> {
    const base = fixture("watchlist.json") as { data: Record<string, unknown> };
    return {
        ...base,
        data: {
            ...base.data,
            counter: counter ?? `${tickers.length}/50`,
            rows: tickers.map((t) => ROWS[t]),
        },
    };
}

const action = (kind: string): Record<string, unknown> => ({
    stonks: `${kind}.v1`,
    url: "https://example.com/watchlist",
    loginWall: false,
    data: { done: true },
});

const call = (ctx: StepContext, step: string, ...args: string[]) => {
    const entry = watchlistSteps[step] ?? browserSteps[step];
    if (entry === undefined) {
        throw new Error(`no step ${step}`);
    }
    return entry.step(ctx, args);
};

const stateOf = (): Record<string, unknown> =>
    JSON.parse(readFileSync(planPath(stateDir, runId), "utf8")) as Record<string, unknown>;

const isStop = (directive: Directive): string =>
    directive.kind === "stop" ? directive.reason : "not a stop";

describe("watchlist-plan", () => {
    it("plans the removals first, then the additions", async () => {
        const ctx = open();
        capture("watchlist", watchlist(["ACME", "HOOL", "CRUX", "GLBX"], "4/50"));
        const out = await call(ctx, "watchlist-plan");
        // Desired from the sheet: GLBX, HOOL, STRK.
        expect(out.markdown).toContain("- Remove: ACME, CRUX");
        expect(out.markdown).toContain("- Add: STRK");
        expect(out.markdown).toContain("4/50");
        expect(out.directive).toEqual({ kind: "remove", ticker: "ACME" });
        const menu = "`action watchlist-row-menu 0 /stocks/us/software/nyse-acme/acme-corp`";
        expect(out.markdown).toContain(menu);
        expect(out.markdown).toContain("`done: false` is a stop");
        expect(out.markdown.indexOf(menu)).toBeLessThan(
            out.markdown.indexOf("`action remove-from-menu`"),
        );
        expect(out.markdown.indexOf("`action remove-from-menu`")).toBeLessThan(
            out.markdown.indexOf("`collector watchlist`"),
        );
        expect(out.markdown.indexOf("`collector watchlist`")).toBeLessThan(
            out.markdown.indexOf("`watchlist-verify`"),
        );
        const state = stateOf();
        expect(state.schema).toBe("stonks.plan.v1");
        expect(state.pending).toEqual([
            { kind: "remove", ticker: "ACME" },
            { kind: "remove", ticker: "CRUX" },
            { kind: "add", ticker: "STRK" },
        ]);
        expect(state.current).toEqual(["ACME", "HOOL", "CRUX", "GLBX"]);
        expect(state.rowPaths).toEqual([
            "/stocks/us/software/nyse-acme/acme-corp",
            "/stocks/us/tech/nasdaqgs-hool/hoolihan-systems",
            "/stocks/us/tech/nasdaq-crux/cruxwell",
            "/stocks/us/energy/nyse-glbx/globex-energy",
        ]);
    });

    it("names the row of a later removal in the collector's order", async () => {
        const ctx = open();
        capture("watchlist", watchlist(["CRUX", "HOOL", "GLBX", "STRK"]));
        const out = await call(ctx, "watchlist-plan");
        expect(out.directive).toEqual({ kind: "remove", ticker: "CRUX" });
        expect(out.markdown).toContain("row 0");
    });

    it("directs to the final read when there is nothing to change", async () => {
        const ctx = open();
        capture("watchlist", watchlist(["GLBX", "HOOL", "STRK"]));
        const out = await call(ctx, "watchlist-plan");
        expect(out.directive).toEqual({ kind: "done" });
        expect(out.markdown).toContain("in step");
        expect(out.markdown).toContain("`collector watchlist`");
        expect(out.markdown).toContain("`watchlist-final`");
        expect(stateOf().pending).toEqual([]);
    });

    it("changes nothing and prints both numbers when the desired set exceeds capacity", async () => {
        const ctx = open();
        capture("watchlist", watchlist(["ACME", "HOOL"], "2/2"));
        const out = await call(ctx, "watchlist-plan");
        expect(out.directive).toEqual({ kind: "done" });
        expect(out.markdown).toContain("3 tickers are desired and the capacity is 2");
        expect(stateOf().pending).toEqual([]);
    });

    it("stops in a full run whose phase 1 has not run", async () => {
        const ctx = open();
        rmSync(reportPath(stateDir, runId));
        capture("watchlist", watchlist(["HOOL"]));
        const out = await call(ctx, "watchlist-plan");
        expect(isStop(out.directive)).toContain("phase 1 has not run");
        expect(existsSync(planPath(stateDir, runId))).toBe(false);
    });

    it("stops while the gate pauses a full run, and plans once sigue has run", async () => {
        const ctx = open();
        writePrivate(
            reportPath(stateDir, runId),
            JSON.stringify({
                ...reportWith(null),
                gate: { tripped: true, affectedTickers: ["ACME"] },
            }),
        );
        capture("watchlist", watchlist(["HOOL"]));
        const paused = await call(ctx, "watchlist-plan");
        expect(isStop(paused.directive)).toContain("sigue");
        expect(existsSync(planPath(stateDir, runId))).toBe(false);

        writePrivate(resumedPath(stateDir, runId), "{}\n");
        const resumed = await call(ctx, "watchlist-plan");
        expect(resumed.directive).toEqual({ kind: "add", ticker: "GLBX" });
    });

    it("plans only the missing additions when resuming --only watchlist", async () => {
        const ctx = open("watchlist");
        capture("watchlist", watchlist(["HOOL"]));
        const out = await call(ctx, "watchlist-plan");
        expect((stateOf().plan as { additions: string[] }).additions).toEqual(["GLBX", "STRK"]);
        expect(stateOf().pending).toEqual([
            { kind: "add", ticker: "GLBX" },
            { kind: "add", ticker: "STRK" },
        ]);
        expect(out.directive).toEqual({ kind: "add", ticker: "GLBX" });
        expect(out.markdown).toContain("`watchlist-search GLBX`");
    });

    it("learns the listings of the watchlist's links", async () => {
        const ctx = open();
        capture("watchlist", watchlist(["HOOL", "GLBX", "STRK"]));
        await call(ctx, "watchlist-plan");
        const learnt = JSON.parse(readFileSync(listingsPath(stateDir), "utf8")) as Record<
            string,
            { symbol: string }
        >;
        expect(learnt.HOOL?.symbol).toBe("NasdaqGS:HOOL");
    });

    it("stops in --only sources", async () => {
        const ctx = open("sources");
        capture("watchlist", watchlist(["HOOL"]));
        const out = await call(ctx, "watchlist-plan");
        expect(isStop(out.directive)).toContain("--only sources");
    });

    it("stops naming the collector when there is no watchlist read", async () => {
        const ctx = open();
        const out = await call(ctx, "watchlist-plan");
        expect(isStop(out.directive)).toContain("run `collector watchlist`");
    });

    it("asks for a login on a login wall", async () => {
        const ctx = open();
        capture("watchlist", { ...fixture("login-wall.json"), stonks: "watchlist.v1" });
        const out = await call(ctx, "watchlist-plan");
        expect(out.directive).toEqual({ kind: "ask-login", source: "watchlist" });
    });

    it("stops when the sheet cannot be read", async () => {
        const ctx = open("full", "not a sheet");
        capture("watchlist", watchlist(["HOOL"]));
        const out = await call(ctx, "watchlist-plan");
        expect(out.directive.kind).toBe("stop");
    });
});

describe("watchlist-search", () => {
    it("prints the target and a known name from the listings", async () => {
        const ctx = open();
        capture("watchlist", watchlist(["HOOL", "GLBX", "STRK"]));
        await call(ctx, "watchlist-plan");
        const out = await call(ctx, "watchlist-search", "HOOL");
        expect(out.markdown).toContain("Target: NasdaqGS:HOOL");
        expect(out.markdown).toContain("Search term: Hoolihan Systems");
        expect(out.directive).toEqual({ kind: "add", ticker: "HOOL" });
        const steps = [
            "`action reposition-add-panel`",
            "`computer` `type`",
            "`action expand-listings`",
            "`collector dropdown`",
            "`watchlist-resolve HOOL`",
        ].map((s) => out.markdown.indexOf(s));
        expect(steps).toEqual([...steps].sort((a, b) => a - b));
        expect(steps.every((i) => i >= 0)).toBe(true);
    });

    it("takes the name from a Cartera Viva card", async () => {
        const ctx = open();
        capture("cartera-viva", fixture("cartera-viva.json"));
        const out = await call(ctx, "watchlist-search", "STRK");
        expect(out.markdown).toContain("Target: STRK on a US primary exchange");
        expect(out.markdown).toContain("Search term: Strike Metals");
    });

    it("tells Claude to search by the company's name when no name is known", async () => {
        const ctx = open();
        const out = await call(ctx, "watchlist-search", "ZORGX");
        expect(out.markdown).toContain(
            "Search term: no name known; search Simply Wall St by ZORGX's company name " +
                "(a hint only; the engine selects the exact listing).",
        );
        expect(out.directive).toEqual({ kind: "add", ticker: "ZORGX" });
    });

    it("needs a ticker", async () => {
        const ctx = open();
        await expect(call(ctx, "watchlist-search")).rejects.toBeInstanceOf(UsageError);
    });
});

async function planAdditions(ctx: StepContext, tickers: string[]): Promise<string> {
    const path = capture("watchlist", watchlist(tickers));
    await call(ctx, "watchlist-plan");
    return path;
}

/** Puts an addition first in the plan by hand, for a ticker no fixture plans. */
function addFirst(ticker: string): void {
    const state = stateOf() as { pending: Directive[] };
    state.pending = [{ kind: "add", ticker }, ...state.pending];
    writeFileSync(planPath(stateDir, runId), JSON.stringify(state));
}

const STRK_DROPDOWN = {
    stonks: "dropdown.v1",
    url: "https://example.com/watchlist",
    loginWall: false,
    data: { rows: [{ index: 3, label: "Strike Metals Inc", symbol: "NYSE:STRK" }] },
};

describe("watchlist-resolve", () => {
    it("selects exactly NasdaqGS:HOOL among similar results", async () => {
        const ctx = open();
        await planAdditions(ctx, ["GLBX", "STRK"]);
        capture("dropdown", fixture("dropdown-hool.json"));
        const out = await call(ctx, "watchlist-resolve", "HOOL");
        expect(out.directive).toEqual({ kind: "add", ticker: "HOOL" });
        expect(out.markdown).toContain("`action click-row 2 NasdaqGS:HOOL`");
        expect(out.markdown).toContain("`done: false` is a stop");
        expect(out.markdown).not.toContain("click-row 0");
        expect(out.markdown.indexOf("`action click-row 2 NasdaqGS:HOOL`")).toBeLessThan(
            out.markdown.indexOf("`collector watchlist`"),
        );
        expect(out.markdown.indexOf("`collector watchlist`")).toBeLessThan(
            out.markdown.indexOf("`watchlist-verify`"),
        );
        expect(stateOf().selected).toMatchObject({ ticker: "HOOL", symbol: "NasdaqGS:HOOL" });
    });

    it("records an unresolved ticker, asks the user and moves on", async () => {
        const ctx = open();
        // The fixture shows no ZORGX row.
        await planAdditions(ctx, ["GLBX"]);
        addFirst("ZORGX");
        capture("dropdown", fixture("dropdown-crux.json"));
        const out = await call(ctx, "watchlist-resolve", "ZORGX");
        expect(out.markdown).toContain("no result is exactly ZORGX on a US primary exchange");
        expect(out.markdown).toContain("Ask the user for the exact listing of ZORGX");
        expect(out.directive).toEqual({ kind: "add", ticker: "HOOL" });
        expect(stateOf().unresolved).toEqual(["ZORGX"]);
        expect(stateOf().pending).toEqual([
            { kind: "add", ticker: "HOOL" },
            { kind: "add", ticker: "STRK" },
        ]);
    });

    it("stops without a dropdown read", async () => {
        const ctx = open();
        await planAdditions(ctx, ["GLBX", "STRK"]);
        const out = await call(ctx, "watchlist-resolve", "HOOL");
        expect(isStop(out.directive)).toContain("run `collector dropdown`");
    });

    it("stops on a dropdown read older than the last watchlist read", async () => {
        const ctx = open();
        capture("dropdown", fixture("dropdown-hool.json"));
        await planAdditions(ctx, ["GLBX", "STRK"]);
        const out = await call(ctx, "watchlist-resolve", "HOOL");
        expect(isStop(out.directive)).toContain("no read since the search for HOOL");
    });

    it("stops on the dropdown read an earlier resolve used", async () => {
        const ctx = open();
        await planAdditions(ctx, ["GLBX"]);
        addFirst("ZORGX");
        capture("dropdown", fixture("dropdown-hool.json"));
        await call(ctx, "watchlist-resolve", "ZORGX");
        // The HOOL row of ZORGX's results must not select HOOL.
        const out = await call(ctx, "watchlist-resolve", "HOOL");
        expect(isStop(out.directive)).toContain("no read since the search for HOOL");
        expect(stateOf().selected).toBeNull();
    });

    it("stops when the ticker is not the next addition", async () => {
        const ctx = open();
        await planAdditions(ctx, ["GLBX", "STRK"]);
        capture("dropdown", fixture("dropdown-hool.json"));
        const out = await call(ctx, "watchlist-resolve", "STRK");
        expect(out.directive.kind).toBe("stop");
    });

    it("stops without a plan", async () => {
        const ctx = open();
        const out = await call(ctx, "watchlist-resolve", "HOOL");
        expect(isStop(out.directive)).toContain("watchlist-plan");
    });
});

describe("watchlist-verify", () => {
    it("verifies a removal and directs to the next change", async () => {
        const ctx = open();
        await planAdditions(ctx, ["ACME", "HOOL", "CRUX", "GLBX"]);
        capture("remove-from-menu", action("remove-from-menu"));
        capture("watchlist", watchlist(["HOOL", "CRUX", "GLBX"]));
        const out = await call(ctx, "watchlist-verify");
        expect(out.directive).toEqual({ kind: "remove", ticker: "CRUX" });
        expect(out.markdown).toContain("Verified: remove ACME");
        expect(out.markdown).toContain(
            "`action watchlist-row-menu 1 /stocks/us/tech/nasdaq-crux/cruxwell`",
        );
        expect(stateOf().pending).toEqual([
            { kind: "remove", ticker: "CRUX" },
            { kind: "add", ticker: "STRK" },
        ]);
        expect(stateOf().done).toEqual([{ kind: "remove", ticker: "ACME" }]);
        expect(stateOf().current).toEqual(["HOOL", "CRUX", "GLBX"]);
    });

    it("stops naming both tickers when another ticker was added", async () => {
        const ctx = open();
        await planAdditions(ctx, ["GLBX", "HOOL"]);
        capture("click-row", action("click-row"));
        capture("watchlist", watchlist(["GLBX", "HOOL", "CRUX"]));
        const out = await call(ctx, "watchlist-verify");
        const reason = isStop(out.directive);
        expect(reason).toContain("CRUX was added instead of STRK");
    });

    it("stops naming a keeper that disappeared", async () => {
        const ctx = open();
        await planAdditions(ctx, ["ACME", "HOOL", "CRUX", "GLBX"]);
        capture("remove-from-menu", action("remove-from-menu"));
        capture("watchlist", watchlist(["HOOL", "CRUX"]));
        const out = await call(ctx, "watchlist-verify");
        expect(isStop(out.directive)).toContain("missing: GLBX");
        expect(stateOf().done).toEqual([]);
    });

    it("stops without a fresh watchlist read", async () => {
        const ctx = open();
        await planAdditions(ctx, ["ACME", "HOOL", "CRUX", "GLBX"]);
        capture("remove-from-menu", action("remove-from-menu"));
        const out = await call(ctx, "watchlist-verify");
        expect(isStop(out.directive)).toContain("no fresh watchlist read");
    });

    it("learns the listing of a verified addition", async () => {
        const ctx = open();
        await planAdditions(ctx, ["GLBX", "HOOL"]);
        capture("dropdown", STRK_DROPDOWN);
        await call(ctx, "watchlist-resolve", "STRK");
        capture("click-row", action("click-row"));
        capture("watchlist", watchlist(["GLBX", "HOOL", "STRK"]));
        const out = await call(ctx, "watchlist-verify");
        expect(out.directive).toEqual({ kind: "done" });
        expect(out.markdown).toContain("`watchlist-final`");
        const learnt = JSON.parse(readFileSync(listingsPath(stateDir), "utf8")) as Record<
            string,
            { symbol: string; name: string; url: string }
        >;
        expect(learnt.STRK).toEqual({
            symbol: "NYSE:STRK",
            name: "Strike Metals",
            url: "https://simplywall.st/stocks/us/materials/nyse-strk/strike-metals",
        });
        expect(stateOf().selected).toBeNull();
    });

    it("stops when the addition landed as another listing of its ticker", async () => {
        const ctx = open();
        await planAdditions(ctx, ["GLBX", "HOOL"]);
        capture("dropdown", STRK_DROPDOWN);
        await call(ctx, "watchlist-resolve", "STRK");
        capture("click-row", action("click-row"));
        const read = watchlist(["GLBX", "HOOL"], "3/50") as { data: { rows: Row[] } };
        read.data.rows.push({
            href: "/stocks/ca/materials/tsx-strk/strike-metals",
            text: "STRK",
            uniqueSymbol: null,
        });
        capture("watchlist", read);
        const out = await call(ctx, "watchlist-verify");
        expect(isStop(out.directive)).toBe("tsx:STRK was added instead of NYSE:STRK");
        expect(stateOf().done).toEqual([]);
        expect(readFileSync(listingsPath(stateDir), "utf8")).not.toContain("tsx-strk");
    });

    it("stops on an addition no resolve selected a listing for", async () => {
        const ctx = open();
        await planAdditions(ctx, ["GLBX", "HOOL"]);
        capture("watchlist", watchlist(["GLBX", "HOOL", "STRK"]));
        const out = await call(ctx, "watchlist-verify");
        expect(isStop(out.directive)).toContain("no listing was selected for STRK");
    });

    it("stops when nothing is pending", async () => {
        const ctx = open();
        await planAdditions(ctx, ["GLBX", "HOOL", "STRK"]);
        const out = await call(ctx, "watchlist-verify");
        expect(isStop(out.directive)).toContain("no change is pending");
    });
});

/** A change applied in the page: a fresh read showing `after`, then `watchlist-verify`. */
async function verified(ctx: StepContext, after: string[]) {
    capture("watchlist", watchlist(after));
    return call(ctx, "watchlist-verify");
}

const PATH = {
    ACME: ROWS.ACME?.href ?? "",
    HOOL: ROWS.HOOL?.href ?? "",
    CRUX: ROWS.CRUX?.href ?? "",
    GLBX: ROWS.GLBX?.href ?? "",
};

const ACME_REFUSAL =
    "the plan's next removal is ACME at row 0; a row menu opens only through " +
    `\`action watchlist-row-menu 0 ${PATH.ACME}\``;

describe("action watchlist-row-menu", () => {
    it("prints the planned removal's row, again on a retry", async () => {
        const ctx = open();
        await planAdditions(ctx, ["ACME", "HOOL", "CRUX", "GLBX"]);
        for (const attempt of [1, 2]) {
            const out = await call(ctx, "action", "watchlist-row-menu", "0", PATH.ACME);
            expect(out.directive, `attempt ${attempt}`).toEqual({ kind: "done" });
            expect(out.markdown).toContain("watchlist-row-menu.v1");
            expect(out.markdown).toContain(JSON.stringify(PATH.ACME));
        }
    });

    it("refuses another row's index or path, and a later removal's row", async () => {
        const ctx = open();
        await planAdditions(ctx, ["ACME", "HOOL", "CRUX", "GLBX"]);
        for (const row of [
            ["1", PATH.ACME],
            ["0", PATH.CRUX],
            ["2", PATH.CRUX],
        ]) {
            const out = await call(ctx, "action", "watchlist-row-menu", ...row);
            expect(isStop(out.directive)).toBe(ACME_REFUSAL);
            expect(out.markdown).not.toContain("```js");
        }
    });

    it("refuses a keeper's row while diagnosing a failing removal", async () => {
        const ctx = open();
        await planAdditions(ctx, ["ACME", "HOOL", "CRUX", "GLBX"]);
        await call(ctx, "action", "watchlist-row-menu", "0", PATH.ACME);
        capture("remove-from-menu", { ...action("remove-from-menu"), data: { done: false } });
        // HOOL and GLBX are desired.
        for (const row of [
            ["1", PATH.HOOL],
            ["3", PATH.GLBX],
        ]) {
            const out = await call(ctx, "action", "watchlist-row-menu", ...row);
            expect(isStop(out.directive)).toBe(ACME_REFUSAL);
            expect(out.markdown).not.toContain("```js");
        }
    });

    it("follows the plan to the next removal once one is verified", async () => {
        const ctx = open();
        await planAdditions(ctx, ["ACME", "HOOL", "CRUX", "GLBX"]);
        await verified(ctx, ["HOOL", "CRUX", "GLBX"]);
        const next = await call(ctx, "action", "watchlist-row-menu", "1", PATH.CRUX);
        expect(next.directive).toEqual({ kind: "done" });
        const done = await call(ctx, "action", "watchlist-row-menu", "0", PATH.ACME);
        expect(isStop(done.directive)).toContain("the plan's next removal is CRUX at row 1");
    });

    it("refuses without a plan", async () => {
        const ctx = open();
        const out = await call(ctx, "action", "watchlist-row-menu", "0", PATH.ACME);
        expect(isStop(out.directive)).toBe(
            "no watchlist plan in this run; run `watchlist-plan` before action watchlist-row-menu",
        );
    });

    it("refuses while the next change is an addition", async () => {
        const ctx = open();
        await planAdditions(ctx, ["GLBX", "HOOL"]);
        const out = await call(ctx, "action", "watchlist-row-menu", "0", PATH.GLBX);
        expect(isStop(out.directive)).toBe(
            "no removal is pending; a row menu opens only for the plan's next removal",
        );
        expect(out.markdown).not.toContain("```js");
    });

    it("keeps a malformed row a usage error", async () => {
        const ctx = open();
        await planAdditions(ctx, ["ACME", "HOOL", "CRUX", "GLBX"]);
        expect(() => call(ctx, "action", "watchlist-row-menu", "0")).toThrow(UsageError);
    });
});

const reportWith = (watchlistResult: Report["watchlist"]): Report => ({
    schema: REPORT_SCHEMA,
    runId,
    generatedAt: "2026-10-04T21:19:00Z",
    ibkr: { provenance: "mcp", positions: 1, orders: 0 },
    counts: { swsPortfolio: 1, carteraViva: 1 },
    warnings: [],
    alerts: [],
    sections: [
        { mirror: "sws-portfolio", findings: [] },
        { mirror: "tracking-sheet", findings: [] },
        { mirror: "cartera-viva", findings: [] },
    ],
    movements: { previousRunDate: null, items: [] },
    gate: { tripped: false, reasons: [] } as unknown as Report["gate"],
    links: {},
    watchlist: watchlistResult,
    snapshot: {
        schema: "stonks.snapshot.v1",
        date: "2026-10-04T21:19:00Z",
        positions: [],
        orders: [],
        findings: [],
    },
});

describe("watchlist-final", () => {
    it("merges the result into the report and prints its path", async () => {
        const ctx = open();
        await planAdditions(ctx, ["ACME", "HOOL", "CRUX", "GLBX"]);
        await verified(ctx, ["HOOL", "CRUX", "GLBX"]);
        await verified(ctx, ["HOOL", "GLBX"]);
        capture("dropdown", STRK_DROPDOWN);
        await call(ctx, "watchlist-resolve", "STRK");
        expect((await verified(ctx, ["HOOL", "GLBX", "STRK"])).directive).toEqual({
            kind: "done",
        });
        writePrivate(reportPath(stateDir, runId), JSON.stringify(reportWith(null)));
        capture("watchlist", watchlist(["GLBX", "HOOL", "STRK"]));
        const out = await call(ctx, "watchlist-final");
        expect(out.directive).toEqual({ kind: "done" });
        const merged = JSON.parse(readFileSync(reportPath(stateDir, runId), "utf8")) as Report;
        expect(merged.watchlist).toEqual({
            removed: ["ACME", "CRUX"],
            added: ["STRK"],
            unresolved: [],
            final: ["GLBX", "HOOL", "STRK"],
            count: 3,
            capacity: 50,
            incomplete: null,
        });
        // Removed tickers link to the pages learnt when the plan read them; the
        // added one to the page this read shows.
        expect(out.markdown).toContain(
            "- Removed: [ACME](https://simplywall.st/stocks/us/software/nyse-acme/acme-corp), " +
                "[CRUX](https://simplywall.st/stocks/us/tech/nasdaq-crux/cruxwell)",
        );
        expect(out.markdown).toContain(
            "- Added: [STRK](https://simplywall.st/stocks/us/materials/nyse-strk/strike-metals)",
        );
        expect(out.markdown).toContain("- Count: 3/50");
        expect(out.markdown.trimEnd().split("\n").at(-1)).toBe(
            `stonks-report-path: ${reportPath(stateDir, runId)}`,
        );
        // The block is the one the report renders.
        const section = renderMarkdown(merged).split("## Watchlist")[1] ?? "";
        expect(out.markdown).toContain(`## Watchlist${section.trimEnd()}`);
    });

    it("prints the block alone when there is no report", async () => {
        const ctx = open("watchlist");
        await planAdditions(ctx, ["GLBX", "HOOL", "STRK"]);
        capture("watchlist", watchlist(["GLBX", "HOOL", "STRK"]));
        const out = await call(ctx, "watchlist-final");
        expect(out.markdown.startsWith("## Watchlist")).toBe(true);
        expect(out.markdown).not.toContain("stonks-report-path");
        expect(existsSync(reportPath(stateDir, runId))).toBe(false);
    });

    it("stops naming the next pending change and the step that starts it", async () => {
        const ctx = open();
        await planAdditions(ctx, ["ACME", "HOOL", "CRUX", "GLBX"]);
        capture("watchlist", watchlist(["GLBX", "HOOL", "ACME"]));
        const out = await call(ctx, "watchlist-final");
        expect(isStop(out.directive)).toBe(
            "the plan's next change, remove ACME, is not verified; run " +
                `\`action watchlist-row-menu 0 ${PATH.ACME}\` and the steps after it before watchlist-final`,
        );
        expect(out.markdown).not.toContain("stonks-report-path");
        const report = JSON.parse(readFileSync(reportPath(stateDir, runId), "utf8")) as Report;
        expect(report.watchlist).toBeNull();
    });

    it("stops on a pending addition, naming its search", async () => {
        const ctx = open();
        await planAdditions(ctx, ["GLBX", "HOOL"]);
        capture("watchlist", watchlist(["GLBX", "HOOL"]));
        const out = await call(ctx, "watchlist-final");
        expect(isStop(out.directive)).toBe(
            "the plan's next change, add STRK, is not verified; run `watchlist-search STRK` " +
                "and the steps after it before watchlist-final",
        );
    });

    it("names the incomplete tickers on a mismatch after the last verify", async () => {
        const ctx = open();
        await planAdditions(ctx, ["ACME", "GLBX", "HOOL", "STRK"]);
        await verified(ctx, ["GLBX", "HOOL", "STRK"]);
        capture("watchlist", watchlist(["GLBX", "HOOL", "CRUX"]));
        const out = await call(ctx, "watchlist-final");
        expect(out.markdown).toContain(
            "- Removed: [ACME](https://simplywall.st/stocks/us/software/nyse-acme/acme-corp)",
        );
        expect(out.markdown).toMatch(
            /- Incomplete: missing \[STRK\]\([^)]+\); unexpected \[CRUX\]\([^)]+\)/,
        );
        expect(out.directive).toEqual({ kind: "done" });
    });

    it("leaves the unresolved out of the added", async () => {
        const ctx = open();
        await planAdditions(ctx, ["GLBX", "HOOL"]);
        capture("dropdown", fixture("dropdown-crux.json"));
        const state = stateOf() as { pending: Directive[] };
        state.pending = [{ kind: "add", ticker: "STRK" }];
        writeFileSync(planPath(stateDir, runId), JSON.stringify(state));
        await call(ctx, "watchlist-resolve", "STRK");
        capture("watchlist", watchlist(["GLBX", "HOOL"]));
        const out = await call(ctx, "watchlist-final");
        expect(out.markdown).toContain("- Added: none");
        // STRK has no page read or learnt: it links to a search.
        expect(out.markdown).toContain("- Unresolved: [STRK](https://simplywall.st/search?q=STRK)");
    });

    it("stops without a fresh read", async () => {
        const ctx = open();
        await planAdditions(ctx, ["GLBX", "HOOL", "STRK"]);
        const out = await call(ctx, "watchlist-final");
        expect(isStop(out.directive)).toContain("no fresh watchlist read");
    });
});
