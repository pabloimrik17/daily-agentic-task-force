import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CONFIG_SCHEMA, type IbkrRead } from "../domain.ts";
import { beginRun, ibkrConfirmedPath, stagedPath, warningsPath } from "../state.ts";
import { ibkrSteps } from "./ibkr.ts";
import { type StepContext, type StepOutput, UsageError } from "./types.ts";

const FIXTURES = join(import.meta.dirname, "fixtures", "phase1");
const fixtureText = (name: string): string => readFileSync(join(FIXTURES, name), "utf8");

const NOW = new Date("2026-10-05T08:00:00Z");

let dir: string;
let stateDir: string;
let runId: string;

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "stonks-ibkr-steps-"));
    stateDir = join(dir, "state");
    writeFileSync(
        join(dir, "config.json"),
        JSON.stringify({
            schema: CONFIG_SCHEMA,
            trackingSheet: { spreadsheetId: "sheet-id", tab: "Tab" },
            swsPortfolio: { url: "https://example.com/portfolio/1" },
            watchlist: { name: "Trader Picks", url: "https://example.com/watchlist" },
            carteraViva: { url: "https://example.com/cartera" },
            excludedTickers: [],
        }),
    );
    ({ runId } = beginRun({ stateDir, mode: "full", now: NOW }));
});

afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
});

const ctx = (stdin?: string): StepContext => ({
    env: { STONKS_CONFIG: join(dir, "config.json"), STONKS_STATE_DIR: stateDir },
    now: () => NOW,
    ...(stdin === undefined ? {} : { stdin }),
});

function step(name: string, context: StepContext, args: string[] = []): Promise<StepOutput> {
    const entry = ibkrSteps[name];
    if (entry === undefined) {
        throw new Error(`no step ${name}`);
    }
    return entry.step(context, args);
}

const warnings = (): unknown => JSON.parse(readFileSync(warningsPath(stateDir, runId), "utf8"));

describe("ibkr-tools", () => {
    it("prints no warning for the known set alone", async () => {
        const out = await step("ibkr-tools", ctx(), [
            "mcp__ibkr__get_account_positions",
            "mcp__ibkr__get_account_orders",
        ]);
        expect(out.directive).toEqual({ kind: "done" });
        expect(out.markdown).toContain("All 2 IBKR tools named are known.");
        expect(warnings()).toEqual([]);
    });

    it("warns about a new tool, records it, and continues", async () => {
        const out = await step("ibkr-tools", ctx(), [
            "mcp__ibkr__get_account_positions",
            "mcp__ibkr__submit_order",
        ]);
        expect(out.directive).toEqual({ kind: "done" });
        const warning =
            "mcp__ibkr__submit_order is not in the known set of IBKR tools; it was not called";
        expect(out.markdown).toContain(`WARNING: ${warning}`);
        expect(warnings()).toEqual([warning]);
    });

    it("records no warning when no names are passed", async () => {
        const out = await step("ibkr-tools", ctx(), []);
        expect(out.markdown).toContain("No IBKR tool names were passed.");
        expect(warnings()).toEqual([]);
    });

    it("says the check runs again when the server awaits login", async () => {
        const out = await step("ibkr-tools", ctx(), [
            "mcp__ibkr__authenticate",
            "mcp__ibkr__complete_authentication",
        ]);
        expect(out.directive).toEqual({ kind: "done" });
        expect(out.markdown).toContain("The `ibkr` server awaits login");
        expect(out.markdown).not.toContain("WARNING");
        expect(warnings()).toEqual([]);
    });

    it("ignores a tool of another server", async () => {
        await step("ibkr-tools", ctx(), ["mcp__other__thing"]);
        expect(warnings()).toEqual([]);
    });
});

describe("ibkr-screenshots-stage", () => {
    it("stages a valid table, renders it and asks for confirmation", async () => {
        const out = await step("ibkr-screenshots-stage", ctx(fixtureText("screenshots.json")));
        expect(out.directive).toEqual({ kind: "done" });
        expect(out.markdown).toContain("## Positions");
        expect(out.markdown).toContain("## Active orders");
        expect(out.markdown).toContain(
            "Confirm this table to continue, or send corrected screenshots.",
        );
        const staged = JSON.parse(readFileSync(stagedPath(stateDir, runId), "utf8")) as IbkrRead;
        expect(staged.provenance).toBe("screenshots");
        expect(staged.positions).toHaveLength(6);
        expect(staged.orders).toHaveLength(5);
    });

    it("asks for the orders screenshot when the orders are missing", async () => {
        const out = await step(
            "ibkr-screenshots-stage",
            ctx(fixtureText("screenshots-no-orders.json")),
        );
        expect(out.directive).toEqual({ kind: "ibkr-fallback" });
        expect(out.markdown).toContain("ask for the orders screenshot");
        expect(existsSync(stagedPath(stateDir, runId))).toBe(false);
    });

    it("rejects positions screens that do not overlap", async () => {
        const out = await step("ibkr-screenshots-stage", ctx(fixtureText("screenshots-gap.json")));
        expect(out.directive).toEqual({ kind: "ibkr-fallback" });
        expect(out.markdown).toContain("do not overlap");
        expect(existsSync(stagedPath(stateDir, runId))).toBe(false);
    });

    it("drops an earlier staged table when a new one fails", async () => {
        await step("ibkr-screenshots-stage", ctx(fixtureText("screenshots.json")));
        await step("ibkr-screenshots-stage", ctx("not json"));
        expect(existsSync(stagedPath(stateDir, runId))).toBe(false);
        expect((await step("ibkr-screenshots-confirm", ctx())).directive.kind).toBe("stop");
    });

    it("takes no arguments", () => {
        expect(() => step("ibkr-screenshots-stage", ctx("{}"), ["extra"])).toThrow(UsageError);
    });
});

describe("ibkr-screenshots-confirm", () => {
    it("stops when nothing is staged", async () => {
        const out = await step("ibkr-screenshots-confirm", ctx());
        expect(out.directive.kind).toBe("stop");
        expect(existsSync(ibkrConfirmedPath(stateDir, runId))).toBe(false);
    });

    it("turns the staged table into the confirmed one", async () => {
        await step("ibkr-screenshots-stage", ctx(fixtureText("screenshots.json")));
        const staged = readFileSync(stagedPath(stateDir, runId), "utf8");
        const out = await step("ibkr-screenshots-confirm", ctx());
        expect(out.directive).toEqual({ kind: "done" });
        expect(out.markdown).toBe("IBKR table confirmed; run `phase1`.");
        expect(existsSync(stagedPath(stateDir, runId))).toBe(false);
        expect(readFileSync(ibkrConfirmedPath(stateDir, runId), "utf8")).toBe(staged);
    });
});
