import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { capture } from "./capture.ts";
import { beginRun, rawDir } from "./state.ts";

const NOW = new Date("2026-10-05T10:00:00.000Z");
const SEQ = String(NOW.getTime()).padStart(15, "0");

const fixture = (folder: string, name: string): string =>
    readFileSync(new URL(`./inputs/fixtures/${folder}/${name}.json`, import.meta.url), "utf8");

// The capture fixtures name this run id; `beginRun` mints its own, so the id is
// substituted into the payload.
let stateDir: string;
let runId: string;
const env = (): Record<string, string> => ({ STONKS_STATE_DIR: stateDir });
const forRun = (text: string): string => text.replaceAll("run-capture-1", runId);
const rawFiles = (): string[] => {
    try {
        return readdirSync(rawDir(stateDir, runId));
    } catch {
        return [];
    }
};

beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), "stonks-capture-"));
    runId = beginRun({ stateDir, mode: "full", now: NOW }).runId;
});

describe("capture", () => {
    it("writes an IBKR read verbatim at 0600", () => {
        const payload = fixture("ibkr", "hook-positions");
        const result = capture(payload, { env: env(), now: NOW });
        const name = `${SEQ}-mcp__ibkr__get_account_positions.json`;
        expect(result.written).toBe(join(rawDir(stateDir, runId), name));
        const path = result.written ?? "";
        expect(readFileSync(path, "utf8")).toBe(
            (JSON.parse(payload) as { tool_response: string }).tool_response,
        );
        expect(statSync(path).mode & 0o777).toBe(0o600);
        expect(basename(path)).toBe(name);
    });

    it("writes the orders read under its tool name", () => {
        const result = capture(fixture("ibkr", "hook-orders"), { env: env(), now: NOW });
        expect(result.written).toMatch(/000\d+-mcp__ibkr__get_account_orders\.json$/);
    });

    it("stringifies a response that is not a string", () => {
        const payload = JSON.stringify({
            tool_name: "mcp__ibkr__get_account_orders",
            tool_response: { orders: [] },
        });
        const result = capture(payload, { env: env(), now: NOW });
        expect(readFileSync(result.written ?? "", "utf8")).toBe('{"orders":[]}');
    });

    it("writes an envelope of the active run from a string response", () => {
        const result = capture(forRun(fixture("capture", "hook-envelope-string")), {
            env: env(),
            now: NOW,
        });
        expect(result.written).toBe(join(rawDir(stateDir, runId), `${SEQ}-sws-portfolio.json`));
        const stored = JSON.parse(readFileSync(result.written ?? "", "utf8")) as { run: string };
        expect(stored.run).toBe(runId);
        expect(statSync(result.written ?? "").mode & 0o777).toBe(0o600);
    });

    it("finds an envelope inside content text, with leading prose", () => {
        const result = capture(forRun(fixture("capture", "hook-envelope-content")), {
            env: env(),
            now: NOW,
        });
        expect(result.written).toBe(join(rawDir(stateDir, runId), `${SEQ}-click-row.json`));
        expect(JSON.parse(readFileSync(result.written ?? "", "utf8"))).toMatchObject({
            data: { toast: "Added ACME" },
        });
    });

    it("finds an envelope when the response is itself an object", () => {
        const payload = JSON.stringify({
            tool_name: "mcp__claude-in-chrome__javascript_tool",
            tool_response: { stonks: "dropdown.v1", run: runId, data: {} },
        });
        const result = capture(payload, { env: env(), now: NOW });
        expect(result.written).toMatch(/-dropdown\.json$/);
    });

    it("ignores another run's envelope", () => {
        const result = capture(fixture("capture", "hook-envelope-other-run"), {
            env: env(),
            now: NOW,
        });
        expect(result.written).toBeNull();
        expect(rawFiles()).toEqual([]);
    });

    it("ignores unrelated JavaScript", () => {
        const result = capture(fixture("capture", "hook-unrelated"), { env: env(), now: NOW });
        expect(result.written).toBeNull();
        expect(rawFiles()).toEqual([]);
    });

    it("writes nothing without an active run", () => {
        const empty = mkdtempSync(join(tmpdir(), "stonks-capture-"));
        const result = capture(fixture("ibkr", "hook-positions"), {
            env: { STONKS_STATE_DIR: empty },
            now: NOW,
        });
        expect(result).toEqual({ written: null, reason: "no active run" });
        expect(readdirSync(empty)).toEqual([]);
    });

    it("writes nothing once the run has expired", () => {
        const later = new Date(NOW.getTime() + 7 * 60 * 60 * 1000);
        const result = capture(fixture("ibkr", "hook-positions"), { env: env(), now: later });
        expect(result.written).toBeNull();
        expect(existsSync(rawDir(stateDir, runId))).toBe(false);
    });

    it("returns without throwing on malformed stdin", () => {
        for (const payload of ["not json", "", "[]", '{"tool_name":7}']) {
            expect(capture(payload, { env: env(), now: NOW }).written).toBeNull();
        }
        expect(rawFiles()).toEqual([]);
    });

    it("ignores any other tool", () => {
        const payload = JSON.stringify({ tool_name: "mcp__ibkr__get_alerts", tool_response: "{}" });
        expect(capture(payload, { env: env(), now: NOW }).written).toBeNull();
    });
});
