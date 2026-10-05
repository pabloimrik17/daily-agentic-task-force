import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runCli } from "../cli.ts";
import { CONFIG_SCHEMA } from "../domain.ts";
import { beginRun, endRun } from "../state.ts";
import { browserSteps } from "./browser.ts";
import { type StepContext, type StepOutput, UsageError } from "./types.ts";

const NOW = new Date("2026-10-05T08:00:00Z");
const HOW =
    "Pass this source to `javascript_tool` unchanged, on its own, never inside `browser_batch`.";

let dir: string;
let stateDir: string;
let runId: string;

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "stonks-browser-steps-"));
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

const ctx = (): StepContext => ({
    env: { STONKS_CONFIG: join(dir, "config.json"), STONKS_STATE_DIR: stateDir },
    now: () => NOW,
});

function step(name: string, args: string[]): Promise<StepOutput> {
    const entry = browserSteps[name];
    if (entry === undefined) {
        throw new Error(`no step ${name}`);
    }
    return entry.step(ctx(), args);
}

describe("collector", () => {
    it("prints the source bound to this run, and how to run it", async () => {
        const out = await step("collector", ["sws-portfolio"]);
        expect(out.directive).toEqual({ kind: "done" });
        expect(out.markdown.startsWith("```js\n")).toBe(true);
        expect(out.markdown).toContain("sws-portfolio.v1");
        expect(out.markdown).toContain(runId);
        expect(out.markdown.endsWith(`\`\`\`\n\n${HOW}`)).toBe(true);
    });

    it("is a usage error for an unknown collector", () => {
        expect(() => step("collector", ["portfolio"])).toThrow(UsageError);
    });

    it("is a usage error without exactly one name", () => {
        expect(() => step("collector", [])).toThrow(UsageError);
        expect(() => step("collector", ["watchlist", "dropdown"])).toThrow(UsageError);
    });

    it("stops when no run is open", async () => {
        endRun(stateDir);
        expect((await step("collector", ["watchlist"])).directive.kind).toBe("stop");
    });
});

describe("action", () => {
    it("prints the action with its row index", async () => {
        const out = await step("action", ["click-row", "2"]);
        expect(out.directive).toEqual({ kind: "done" });
        expect(out.markdown).toContain("click-row.v1");
        expect(out.markdown).toContain(HOW);
    });

    it("exits 1 for a row index that is not a number", async () => {
        let stderr = "";
        const code = await runCli(["action", "click-row", "x"], ctx(), {
            stdout: () => undefined,
            stderr: (text) => (stderr += text),
        });
        expect(code).toBe(1);
        expect(stderr).toContain("click-row takes one row index");
    });

    it("is a usage error for an unknown action", () => {
        expect(() => step("action", ["delete-everything"])).toThrow(UsageError);
    });
});
