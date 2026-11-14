import { appendFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { tempState } from "../attempts/test-fixtures.ts";
import { DEAD, NOW } from "./test-fixtures.ts";
import { NOTICES_POLL_MS, type NoticesIo, waitForNotices } from "./wait-notices.ts";

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

// Before any file a test writes, so those files are the current loop's.
const LONG_AGO = new Date("2026-01-01T00:00:00.000Z");

function loopLock(dir: string, pid: number, startedAt: Date = LONG_AGO): void {
    writeFileSync(
        join(dir, "loop.lock"),
        JSON.stringify({ pid, startedAt: startedAt.toISOString() }),
    );
}

const notice = (dir: string, line: string) =>
    appendFileSync(join(dir, "loop.notices"), `${line}\n`);

// `onWait` runs on each poll, as the loop would between two reads.
function harness(
    dir: string,
    onWait: (n: number) => void = () => undefined,
    overrides: Partial<NoticesIo> = {},
) {
    const out: string[] = [];
    const waits: number[] = [];
    const io: NoticesIo = {
        state: dir,
        now: () => NOW,
        wait: (ms) => {
            waits.push(ms);
            onWait(waits.length);
            return Promise.resolve();
        },
        stdout: (text) => out.push(text),
        ...overrides,
    };
    return { io, out, waits };
}

// The default grace of 10 s, in polls.
const GRACE = Array.from({ length: 5 }, () => NOTICES_POLL_MS);

describe("waitForNotices with a live loop", () => {
    it("prints the notices after the first n and the new count", async () => {
        const dir = state();
        loopLock(dir, process.pid);
        for (const line of ["one", "two", "three"]) {
            notice(dir, line);
        }
        const h = harness(dir);
        expect(await waitForNotices(1, h.io)).toBe(0);
        expect(h.out).toEqual(["two\nthree\nnext: 3"]);
        expect(h.waits).toEqual([]);
    });

    it("waits while the loop is alive, then prints the first notice and next: 1", async () => {
        const dir = state();
        loopLock(dir, process.pid);
        writeFileSync(join(dir, "loop.notices"), "");
        const h = harness(dir, (n) => {
            if (n === 3) {
                notice(dir, "linear:DOT-98 grill-me → proposal");
            }
        });
        expect(await waitForNotices(0, h.io)).toBe(0);
        expect(h.waits).toEqual([NOTICES_POLL_MS, NOTICES_POLL_MS, NOTICES_POLL_MS]);
        expect(h.out).toEqual(["linear:DOT-98 grill-me → proposal\nnext: 1"]);
    });

    it("says the loop is not running, with code 2, as soon as its process is gone", async () => {
        const dir = state();
        loopLock(dir, process.pid);
        for (const line of ["a", "b", "c"]) {
            notice(dir, line);
        }
        const h = harness(dir, () => loopLock(dir, DEAD));
        expect(await waitForNotices(3, h.io)).toBe(2);
        expect(h.waits).toEqual([NOTICES_POLL_MS]);
        expect(h.out).toEqual(["loop stopped: not running"]);
    });

    it("ignores an earlier loop's notices until the new loop empties the file", async () => {
        const dir = state();
        const startedAt = new Date(Date.now() - 60_000);
        notice(dir, "loop stopped: received SIGTERM");
        const before = new Date(startedAt.getTime() - 60_000);
        utimesSync(join(dir, "loop.notices"), before, before);
        loopLock(dir, process.pid, startedAt);
        const h = harness(dir, (n) => {
            if (n === 2) {
                writeFileSync(join(dir, "loop.notices"), "");
            }
            if (n === 3) {
                notice(dir, "linear:DOT-98 grill-me → proposal");
            }
        });
        expect(await waitForNotices(0, h.io)).toBe(0);
        expect(h.waits).toHaveLength(3);
        expect(h.out).toEqual(["linear:DOT-98 grill-me → proposal\nnext: 1"]);
    });
});

describe("waitForNotices before a loop is alive", () => {
    it("follows a loop that takes its lock within the grace period", async () => {
        const dir = state();
        const h = harness(dir, (n) => {
            if (n === 2) {
                loopLock(dir, process.pid);
                writeFileSync(join(dir, "loop.notices"), "");
            }
            if (n === 4) {
                notice(dir, "retained linear:DOT-77:grill-me:1: session exited");
            }
        });
        expect(await waitForNotices(0, h.io)).toBe(0);
        expect(h.waits).toHaveLength(4);
        expect(h.out).toEqual(["retained linear:DOT-77:grill-me:1: session exited\nnext: 1"]);
    });

    it("says the loop is not running, with code 2, when none appears within the grace", async () => {
        const h = harness(state());
        expect(await waitForNotices(0, h.io)).toBe(2);
        expect(h.waits).toEqual(GRACE);
        expect(h.out).toEqual(["loop stopped: not running"]);
    });

    it("takes a lock whose owner is dead as no loop", async () => {
        const dir = state();
        loopLock(dir, DEAD);
        const h = harness(dir);
        expect(await waitForNotices(0, h.io)).toBe(2);
        expect(h.waits).toEqual(GRACE);
    });

    it("prints the unread stop notice of a loop that stopped, after the grace", async () => {
        const dir = state();
        notice(dir, "linear:DOT-98 grill-me → proposal");
        notice(dir, "loop stopped: received SIGINT");
        const h = harness(dir);
        expect(await waitForNotices(1, h.io)).toBe(0);
        expect(h.waits).toEqual(GRACE);
        expect(h.out).toEqual(["loop stopped: received SIGINT\nnext: 2"]);
    });

    it("takes the grace period it is given", async () => {
        const h = harness(state(), () => undefined, { graceMs: 4_000 });
        expect(await waitForNotices(0, h.io)).toBe(2);
        expect(h.waits).toEqual([NOTICES_POLL_MS, NOTICES_POLL_MS]);
    });
});
