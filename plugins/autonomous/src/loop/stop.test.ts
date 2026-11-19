import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { tempState } from "../attempts/test-fixtures.ts";
import { DEAD, NOW } from "./test-fixtures.ts";
import { STOP_POLL_MS, STOP_WAIT_MS, stopLoop, type StopIo } from "./stop.ts";

const STATES: string[] = [];
afterAll(() => {
    for (const dir of STATES) {
        rmSync(dir, { recursive: true, force: true });
    }
});

function state(): string {
    const dir = tempState();
    STATES.push(dir);
    return dir;
}

const LOOP_PID = process.pid;
const LOCK = (dir: string) => join(dir, "loop.lock");

function loopLock(dir: string, pid: number): void {
    writeFileSync(LOCK(dir), JSON.stringify({ pid, startedAt: NOW.toISOString() }));
}

function errno(code: string, message: string): Error {
    return Object.assign(new Error(message), { code });
}

// `onWait` runs on each poll, as the loop would between two reads.
function harness(
    dir: string,
    overrides: Partial<StopIo> = {},
    onWait: (n: number) => void = () => undefined,
) {
    const out: string[] = [];
    const err: string[] = [];
    const waits: number[] = [];
    const signals: number[] = [];
    const io: StopIo = {
        state: dir,
        now: () => NOW,
        wait: (ms) => {
            waits.push(ms);
            onWait(waits.length);
            return Promise.resolve();
        },
        stdout: (text) => out.push(text),
        stderr: (text) => err.push(text),
        signal: (pid) => {
            signals.push(pid);
        },
        ...overrides,
    };
    return { io, out, err, waits, signals };
}

// The signal is recorded before it throws.
function refusing(h: { signals: number[] }, error: Error): Partial<StopIo> {
    return {
        signal: (pid) => {
            h.signals.push(pid);
            throw error;
        },
    };
}

describe("stopLoop without a live loop", () => {
    it("prints not running and exits 2 when there is no lock, sending nothing", async () => {
        const dir = state();
        const h = harness(dir);
        expect(await stopLoop(h.io)).toBe(2);
        expect(h.out).toEqual(["loop stopped: not running"]);
        expect(h.err).toEqual([]);
        expect(h.signals).toEqual([]);
        expect(h.waits).toEqual([]);
        expect(readdirSync(dir)).toEqual([]);
    });

    it("treats a lock of a dead owner as not running, sending nothing and leaving the lock", async () => {
        const dir = state();
        loopLock(dir, DEAD);
        const before = readFileSync(LOCK(dir), "utf8");
        const h = harness(dir);
        expect(await stopLoop(h.io)).toBe(2);
        expect(h.out).toEqual(["loop stopped: not running"]);
        expect(h.signals).toEqual([]);
        expect(readFileSync(LOCK(dir), "utf8")).toBe(before);
    });

    it("treats a process that disappears before the signal as not running, sending one signal", async () => {
        const dir = state();
        loopLock(dir, LOOP_PID);
        const h = harness(dir);
        Object.assign(h.io, refusing(h, errno("ESRCH", "kill ESRCH")));
        expect(await stopLoop(h.io)).toBe(2);
        expect(h.out).toEqual(["loop stopped: not running"]);
        expect(h.err).toEqual([]);
        expect(h.signals).toEqual([LOOP_PID]);
        expect(h.waits).toEqual([]);
    });
});

describe("stopLoop with errors", () => {
    it("reports a refused signal on stderr and exits 1, sending one signal", async () => {
        const dir = state();
        loopLock(dir, LOOP_PID);
        const h = harness(dir);
        Object.assign(h.io, refusing(h, errno("EPERM", "kill EPERM")));
        expect(await stopLoop(h.io)).toBe(1);
        expect(h.out).toEqual([]);
        expect(h.err).toHaveLength(1);
        expect(h.err[0]).toContain(`pid ${LOOP_PID}`);
        expect(h.err[0]).toContain("kill EPERM");
        expect(h.signals).toEqual([LOOP_PID]);
        expect(h.waits).toEqual([]);
        expect(readFileSync(LOCK(dir), "utf8")).toContain(`"pid":${LOOP_PID}`);
    });

    it("reports a lock with no readable owner on stderr and exits 1, sending nothing", async () => {
        const dir = state();
        writeFileSync(LOCK(dir), "");
        const h = harness(dir);
        expect(await stopLoop(h.io)).toBe(1);
        expect(h.out).toEqual([]);
        expect(h.err).toEqual([expect.stringContaining("its lock names no owner")]);
        expect(h.signals).toEqual([]);
        expect(readFileSync(LOCK(dir), "utf8")).toBe("");
    });
});

describe("stopLoop with a live loop", () => {
    it("prints loop stopped at once when the loop has ended by the first look", async () => {
        const dir = state();
        loopLock(dir, LOOP_PID);
        const h = harness(dir, {
            signal: (pid) => {
                h.signals.push(pid);
                rmSync(LOCK(dir));
            },
        });
        expect(await stopLoop(h.io)).toBe(0);
        expect(h.out).toEqual(["loop stopped"]);
        expect(h.err).toEqual([]);
        expect(h.signals).toEqual([LOOP_PID]);
        expect(h.waits).toEqual([]);
    });

    it("prints loop stopped when the loop ends within the wait, polling every 250 ms", async () => {
        const dir = state();
        loopLock(dir, LOOP_PID);
        const h = harness(dir, {}, (n) => {
            if (n === 3) {
                rmSync(LOCK(dir));
            }
        });
        expect(await stopLoop(h.io)).toBe(0);
        expect(h.out).toEqual(["loop stopped"]);
        expect(h.waits).toEqual([STOP_POLL_MS, STOP_POLL_MS, STOP_POLL_MS]);
        expect(h.signals).toEqual([LOOP_PID]);
    });

    it("prints loop stopping when the loop is still alive after 10 s, sending one signal", async () => {
        const dir = state();
        loopLock(dir, LOOP_PID);
        const h = harness(dir);
        expect(await stopLoop(h.io)).toBe(0);
        expect(h.out).toEqual(["loop stopping: the iteration in progress ends first"]);
        expect(h.err).toEqual([]);
        expect(h.waits).toHaveLength(STOP_WAIT_MS / STOP_POLL_MS);
        expect(h.waits.every((ms) => ms === STOP_POLL_MS)).toBe(true);
        expect(h.signals).toEqual([LOOP_PID]);
    });

    it("sees a loop that ends at the last poll", async () => {
        const dir = state();
        loopLock(dir, LOOP_PID);
        const polls = STOP_WAIT_MS / STOP_POLL_MS;
        const h = harness(dir, {}, (n) => {
            if (n === polls) {
                rmSync(LOCK(dir));
            }
        });
        expect(await stopLoop(h.io)).toBe(0);
        expect(h.out).toEqual(["loop stopped"]);
        expect(h.signals).toEqual([LOOP_PID]);
    });

    it("leaves a stale lock on disk when the loop ends without releasing it", async () => {
        const dir = state();
        loopLock(dir, LOOP_PID);
        const stale = JSON.stringify({ pid: DEAD, startedAt: NOW.toISOString() });
        const h = harness(dir, {}, (n) => {
            if (n === 1) {
                writeFileSync(LOCK(dir), stale);
            }
        });
        expect(await stopLoop(h.io)).toBe(0);
        expect(h.out).toEqual(["loop stopped"]);
        expect(h.signals).toEqual([LOOP_PID]);
        expect(readFileSync(LOCK(dir), "utf8")).toBe(stale);
    });
});
