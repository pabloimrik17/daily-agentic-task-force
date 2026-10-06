import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { USAGE } from "./args.ts";
import { EXAMPLE_PATH } from "./config.ts";
import { CONFIG_SCHEMA, type Directive } from "./domain.ts";
import { runCli, stdinSteps, type StepContext } from "./cli.ts";
import type { RunnerResult } from "./inputs/sheet-gws.ts";
import { activePath, readActiveRun, rawDir, reportPath, writePrivate } from "./state.ts";

let dir: string;
let stateDir: string;
let configPath: string;

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "stonks-cli-"));
    stateDir = join(dir, "state");
    configPath = join(dir, "config.json");
});

afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
});

const NOW = new Date("2026-10-04T21:19:00Z");

const ctx = (): StepContext => ({
    env: { STONKS_CONFIG: configPath, STONKS_STATE_DIR: stateDir },
    now: () => NOW,
});

async function run(argv: string[], context: StepContext = ctx()) {
    let stdout = "";
    let stderr = "";
    const code = await runCli(argv, context, {
        stdout: (text) => (stdout += text),
        stderr: (text) => (stderr += text),
    });
    return { code, stdout, stderr };
}

const lastLine = (text: string) => text.trimEnd().split("\n").at(-1);

function writeConfig() {
    writeFileSync(
        configPath,
        JSON.stringify({
            schema: CONFIG_SCHEMA,
            trackingSheet: { spreadsheetId: "sheet-id", tab: "Tab" },
            swsPortfolio: { url: "https://example.com/portfolio/1" },
            watchlist: { name: "Watch", url: "https://example.com/watchlist" },
            carteraViva: { url: "https://example.com/cartera" },
            excludedTickers: ["ETFX"],
        }),
    );
}

describe("begin", () => {
    it("prints the usage, exits 1 and reads nothing for a bad --only", async () => {
        mkdtempSync(join(dir, "marker-"));
        const before = readdirSync(dir);
        const result = await run(["begin", "--only", "portfolio"]);
        expect(result.code).toBe(1);
        expect(result.stdout).toBe("");
        expect(result.stderr).toContain(USAGE);
        expect(existsSync(stateDir)).toBe(false);
        expect(readdirSync(dir)).toEqual(before);
    });

    it("opens the run and lists phase 1's reads in the default mode", async () => {
        writeConfig();
        const result = await run(["begin"]);
        expect(result.code).toBe(0);
        expect(existsSync(activePath(stateDir))).toBe(true);
        expect(result.stdout).toContain("mcp__ibkr__get_account_positions");
        expect(result.stdout).toContain("mcp__ibkr__get_account_orders");
        expect(result.stdout).toContain("tracking sheet");
        expect(result.stdout).toContain(
            "- SWS portfolio: its collector, at https://example.com/portfolio/1\n",
        );
        expect(result.stdout).toContain(
            "- Cartera Viva: its collector, at https://example.com/cartera\n",
        );
        expect(result.stdout).toContain("`ibkr-tools`");
        expect(result.stdout).toContain("run `phase1`");
        expect(result.stdout).toContain(
            "The watchlist (https://example.com/watchlist) is read in phase 2, just before `watchlist-plan`, never before the gate.",
        );
        expect(result.stdout).not.toContain("- watchlist: its collector");
        expect(lastLine(result.stdout)).toBe('directive: {"kind":"done"}');
        expect(result.stdout).toMatch(/\n\ndirective: /);
    });

    it("lists phase 1's reads without phase 2 for --only sources", async () => {
        writeConfig();
        const result = await run(["begin", "--only", "sources"]);
        expect(result.stdout).toContain(
            "- SWS portfolio: its collector, at https://example.com/portfolio/1\n",
        );
        expect(result.stdout).toContain(
            "- Cartera Viva: its collector, at https://example.com/cartera\n",
        );
        expect(result.stdout).not.toContain("watchlist");
    });

    it("lists only the sheet and the watchlist for --only watchlist", async () => {
        writeConfig();
        const result = await run(["begin", "--only", "watchlist"]);
        expect(result.code).toBe(0);
        expect(result.stdout).toContain(
            "- watchlist: its collector, at https://example.com/watchlist\n",
        );
        expect(result.stdout).toContain("run `watchlist-plan`");
        expect(result.stdout).not.toContain("mcp__ibkr");
        expect(result.stdout).not.toContain("Cartera Viva");
        expect(result.stdout).not.toContain("phase1");
    });

    it("stops naming the path and the example when the config is missing", async () => {
        const result = await run(["begin"]);
        expect(result.code).toBe(0);
        const directive = JSON.parse(
            (lastLine(result.stdout) ?? "").slice("directive: ".length),
        ) as Directive;
        expect(directive.kind).toBe("stop");
        const reason = directive.kind === "stop" ? directive.reason : "";
        expect(reason).toContain(configPath);
        expect(reason).toContain(EXAMPLE_PATH);
        expect(existsSync(activePath(stateDir))).toBe(false);
    });
});

describe("end", () => {
    it("clears the active run", async () => {
        writeConfig();
        await run(["begin"]);
        const result = await run(["end"]);
        expect(result.code).toBe(0);
        expect(lastLine(result.stdout)).toBe('directive: {"kind":"done"}');
        expect(existsSync(activePath(stateDir))).toBe(false);
    });
});

describe("runCli", () => {
    it("exits 1 for an unknown step and lists the registered ones", async () => {
        const result = await run(["nope"]);
        expect(result.code).toBe(1);
        expect(result.stdout).toBe("");
        expect(result.stderr).toContain(
            "Steps: begin, end, ibkr-tools, ibkr-screenshots-stage, ibkr-screenshots-confirm, collector, action, phase1, sigue, watchlist-plan, watchlist-search, watchlist-resolve, watchlist-verify, watchlist-final",
        );
    });

    it("exits 1 when no step is given", async () => {
        expect((await run([])).code).toBe(1);
    });

    it("reads standard input only for the screenshot stage", () => {
        expect([...stdinSteps]).toEqual(["ibkr-screenshots-stage"]);
    });
});

describe("phase1 through the CLI", () => {
    const fixtures = join(import.meta.dirname, "inputs", "fixtures");
    const phase1Fixtures = join(import.meta.dirname, "steps", "fixtures", "phase1");
    const text = (path: string) => readFileSync(path, "utf8");

    it("prints the report, the line the pane reads, then the directive", async () => {
        writeConfig();
        await run(["begin"]);
        const runId = readActiveRun({ stateDir, now: NOW })?.runId ?? "";
        const raw = rawDir(stateDir, runId);
        for (const [seq, tool] of [
            ["000000000000001", "positions"],
            ["000000000000002", "orders"],
        ]) {
            const hook = JSON.parse(text(join(fixtures, "ibkr", `hook-${tool}.json`))) as {
                tool_name: string;
                tool_response: string;
            };
            writePrivate(join(raw, `${seq}-${hook.tool_name}.json`), hook.tool_response);
        }
        for (const kind of ["sws-portfolio", "cartera-viva"]) {
            const body = JSON.parse(text(join(phase1Fixtures, `${kind}.json`))) as object;
            writePrivate(
                join(raw, `000000000000003-${kind}.json`),
                JSON.stringify({ ...body, run: runId }),
            );
        }
        const values = JSON.parse(text(join(phase1Fixtures, "values-clean.json"))) as unknown;
        const sheet: RunnerResult = { code: 0, stdout: JSON.stringify({ values }), stderr: "" };
        const result = await run(["phase1"], {
            ...ctx(),
            sheetRunner: () => Promise.resolve(sheet),
        });
        expect(result.code).toBe(0);
        expect(result.stdout.startsWith("# Stonks · phase 1")).toBe(true);
        // The pane's feed (mod/register.ts PATH_LINE).
        expect(/^stonks-report-path: (.+)$/m.exec(result.stdout)?.[1]).toBe(
            reportPath(stateDir, runId),
        );
        expect(lastLine(result.stdout)).toBe('directive: {"kind":"done"}');
    });
});
