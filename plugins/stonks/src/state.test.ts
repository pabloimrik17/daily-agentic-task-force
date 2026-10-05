import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    statSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
    activePath,
    beginRun,
    ensureDir,
    endRun,
    handoffPath,
    previousPath,
    reauthOfferedPath,
    readActiveRun,
    resolveStateDir,
    RUN_EXPIRY_MS,
    runDir,
    runsDir,
    stagedPath,
    warningsPath,
} from "./state.ts";

let stateDir: string;

beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), "stonks-state-"));
});

afterEach(() => {
    rmSync(stateDir, { recursive: true, force: true });
});

const mode = (path: string) => statSync(path).mode & 0o777;
const t0 = new Date("2026-10-04T21:19:00Z");

describe("resolveStateDir", () => {
    it("prefers STONKS_STATE_DIR", () => {
        expect(resolveStateDir({ STONKS_STATE_DIR: "/s", XDG_STATE_HOME: "/x" })).toBe("/s");
    });

    it("uses XDG_STATE_HOME", () => {
        expect(resolveStateDir({ XDG_STATE_HOME: "/x", HOME: "/h" })).toBe(join("/x", "stonks"));
    });

    it("defaults to HOME/.local/state/stonks", () => {
        expect(resolveStateDir({ HOME: "/h" })).toBe(join("/h", ".local", "state", "stonks"));
    });
});

describe("beginRun", () => {
    it("creates the run directory, id and active.json", () => {
        const { runId, runDir: dir } = beginRun({ stateDir, mode: "full", now: t0 });
        expect(runId).toMatch(/^20261004T211900Z-[0-9a-f]+$/);
        expect(dir).toBe(runDir(stateDir, runId));
        expect(JSON.parse(readFileSync(activePath(stateDir), "utf8"))).toEqual({
            runId,
            startedAt: "2026-10-04T21:19:00.000Z",
            mode: "full",
        });
    });

    it("removes the previous run directory", () => {
        const first = beginRun({ stateDir, mode: "full", now: t0 });
        writeFileSync(join(first.runDir, "report.json"), "{}");
        const second = beginRun({ stateDir, mode: "sources", now: new Date(t0.getTime() + 1000) });
        expect(existsSync(first.runDir)).toBe(false);
        expect(existsSync(second.runDir)).toBe(true);
    });

    it("uses 0700 for directories and 0600 for files", () => {
        mkdirSync(stateDir, { recursive: true });
        writeFileSync(handoffPath(stateDir), "{}", { mode: 0o644 });
        const { runId, runDir: dir } = beginRun({ stateDir, mode: "full", now: t0 });
        expect(mode(dir)).toBe(0o700);
        expect(mode(runsDir(stateDir))).toBe(0o700);
        expect(mode(activePath(stateDir))).toBe(0o600);
        expect(mode(previousPath(stateDir, runId))).toBe(0o600);
    });

    it("moves the handoff into the run exactly once", () => {
        writeFileSync(handoffPath(stateDir), '{"x":1}');
        const first = beginRun({ stateDir, mode: "full", now: t0 });
        expect(existsSync(handoffPath(stateDir))).toBe(false);
        expect(readFileSync(previousPath(stateDir, first.runId), "utf8")).toBe('{"x":1}');
        const second = beginRun({ stateDir, mode: "full", now: new Date(t0.getTime() + 1000) });
        expect(existsSync(previousPath(stateDir, second.runId))).toBe(false);
    });
});

describe("ensureDir", () => {
    it("creates nested directories at 0700 and tightens an existing one", () => {
        const nested = join(stateDir, "a", "b");
        ensureDir(nested);
        expect(mode(nested)).toBe(0o700);
        mkdirSync(join(stateDir, "open"), { mode: 0o755 });
        ensureDir(join(stateDir, "open"));
        expect(mode(join(stateDir, "open"))).toBe(0o700);
    });
});

describe("run files", () => {
    it("live in the run directory, so the next begin deletes them", () => {
        const dir = runDir(stateDir, "r1");
        expect(warningsPath(stateDir, "r1")).toBe(join(dir, "warnings.json"));
        expect(reauthOfferedPath(stateDir, "r1")).toBe(join(dir, "ibkr-reauth-offered.json"));
        expect(stagedPath(stateDir, "r1")).toBe(join(dir, "ibkr-staged.json"));
    });
});

describe("readActiveRun", () => {
    it("returns the open run", () => {
        const { runId } = beginRun({ stateDir, mode: "watchlist", now: t0 });
        const later = new Date(t0.getTime() + 60 * 60 * 1000);
        expect(readActiveRun({ stateDir, now: later })).toEqual({
            runId,
            startedAt: t0.toISOString(),
            mode: "watchlist",
        });
    });

    it("returns null when there is none", () => {
        expect(readActiveRun({ stateDir, now: t0 })).toBeNull();
    });

    it("returns null once expired, so a capture writes nothing", () => {
        expect(RUN_EXPIRY_MS).toBe(6 * 60 * 60 * 1000);
        beginRun({ stateDir, mode: "full", now: t0 });
        const expired = new Date(t0.getTime() + RUN_EXPIRY_MS + 1);
        expect(readActiveRun({ stateDir, now: expired })).toBeNull();
    });

    it("returns null for a malformed file", () => {
        writeFileSync(activePath(stateDir), '{"runId":1}');
        expect(readActiveRun({ stateDir, now: t0 })).toBeNull();
    });
});

describe("endRun", () => {
    it("clears the active run and tolerates none", () => {
        beginRun({ stateDir, mode: "full", now: t0 });
        endRun(stateDir);
        expect(readActiveRun({ stateDir, now: t0 })).toBeNull();
        expect(() => endRun(stateDir)).not.toThrow();
    });
});
