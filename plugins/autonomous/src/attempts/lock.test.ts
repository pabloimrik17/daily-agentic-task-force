import { readFile, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { acquireLock, acquireLoopLock, loopIsAlive, readLoopLock } from "./lock.ts";
import { tempState } from "./test-fixtures.ts";

const DEAD = 2 ** 22;
const NOW = new Date("2026-10-17T12:00:00.000Z");

let state: string;
let file: string;

beforeEach(() => {
    state = tempState();
    file = join(state, "run.lock");
});

afterEach(async () => {
    await rm(state, { recursive: true, force: true });
});

async function heldPid(): Promise<unknown> {
    return (JSON.parse(await readFile(file, "utf8")) as { pid: unknown }).pid;
}

function writeLock(pid: number): Promise<void> {
    return writeFile(file, JSON.stringify({ pid, startedAt: "2026-10-17T11:00:00.000Z" }));
}

// Sets the lock's mtime to `ageMs` before NOW, the clock acquire compares against.
function setAge(ageMs: number): Promise<void> {
    const mtime = new Date(NOW.getTime() - ageMs);
    return utimes(file, mtime, mtime);
}

describe("acquireLock", () => {
    it("writes the pid and start time", async () => {
        const lock = await acquireLock(state, 4242, NOW);
        expect(lock.ok).toBe(true);
        expect(JSON.parse(await readFile(file, "utf8"))).toEqual({
            pid: 4242,
            startedAt: NOW.toISOString(),
        });
    });

    it("fails against a live holder, naming it", async () => {
        await writeLock(process.pid);
        const lock = await acquireLock(state, 4242, NOW);
        expect(lock).toEqual({
            ok: false,
            error: `another run holds ${file} (pid ${process.pid}, started 2026-10-17T11:00:00.000Z)`,
        });
    });

    it("reclaims a lock whose process is gone", async () => {
        expect(() => process.kill(DEAD, 0)).toThrow(/ESRCH/);
        await writeLock(DEAD);
        const lock = await acquireLock(state, 4242, NOW);
        expect(lock.ok).toBe(true);
        expect(await heldPid()).toBe(4242);
        expect(await readdir(state)).toEqual(["run.lock"]);
    });

    it("reclaims an unparsable lock once it is older than the grace period", async () => {
        await writeFile(file, "not json");
        await setAge(60_000);
        expect((await acquireLock(state, 4242, NOW)).ok).toBe(true);
        expect(await heldPid()).toBe(4242);
    });

    it("reclaims an empty lock once it is older than the grace period", async () => {
        await writeFile(file, "");
        await setAge(60_000);
        expect((await acquireLock(state, 4242, NOW)).ok).toBe(true);
        expect(await heldPid()).toBe(4242);
    });

    it("reports a fresh empty lock as held", async () => {
        await writeFile(file, "");
        await setAge(1_000);
        expect(await acquireLock(state, 4242, NOW)).toEqual({
            ok: false,
            error: `another run holds ${file}`,
        });
        expect(await readFile(file, "utf8")).toBe("");
    });

    it("reports a fresh unparsable lock as held", async () => {
        await writeFile(file, "not json");
        await setAge(1_000);
        expect((await acquireLock(state, 4242, NOW)).ok).toBe(false);
        expect(await readFile(file, "utf8")).toBe("not json");
    });

    it("reclaims a dead owner's lock at once, however fresh", async () => {
        await writeLock(DEAD);
        await setAge(0);
        expect((await acquireLock(state, 4242, NOW)).ok).toBe(true);
        expect(await heldPid()).toBe(4242);
    });

    it("creates the state directory", async () => {
        const nested = join(state, "a", "b");
        expect((await acquireLock(nested, 4242, NOW)).ok).toBe(true);
    });
});

describe("release", () => {
    it("removes the lock it holds", async () => {
        const lock = await acquireLock(state, 4242, NOW);
        if (!lock.ok) {
            throw new Error(lock.error);
        }
        await lock.release();
        expect(await readdir(state)).toEqual([]);
        await lock.release();
    });

    it("leaves a lock another process now holds", async () => {
        const lock = await acquireLock(state, 4242, NOW);
        if (!lock.ok) {
            throw new Error(lock.error);
        }
        await writeLock(process.pid);
        await lock.release();
        expect(await heldPid()).toBe(process.pid);
    });
});

describe("loop lock", () => {
    const loopFile = () => join(state, "loop.lock");

    it("refuses a second loop while the first is alive, naming it", async () => {
        const first = await acquireLoopLock(state, process.pid, NOW);
        expect(first.ok).toBe(true);
        expect(await acquireLoopLock(state, 4242, NOW)).toEqual({
            ok: false,
            error: `another loop holds ${loopFile()} (pid ${process.pid}, started ${NOW.toISOString()})`,
        });
    });

    it("reclaims the lock of a loop that died", async () => {
        await writeFile(
            loopFile(),
            JSON.stringify({ pid: DEAD, startedAt: "2026-10-17T11:00:00.000Z" }),
        );
        expect((await acquireLoopLock(state, 4242, NOW)).ok).toBe(true);
        const owner = JSON.parse(await readFile(loopFile(), "utf8")) as { pid: number };
        expect(owner.pid).toBe(4242);
    });

    it("releases only its own lock", async () => {
        const lock = await acquireLoopLock(state, 4242, NOW);
        if (!lock.ok) {
            throw new Error(lock.error);
        }
        await lock.release();
        expect(await readdir(state)).toEqual([]);
    });

    it("does not stop a run", async () => {
        await acquireLoopLock(state, process.pid, NOW);
        const run = await acquireLock(state, 4242, NOW);
        expect(run.ok).toBe(true);
        expect((await readdir(state)).sort()).toEqual(["loop.lock", "run.lock"]);
    });

    it("is not stopped by a held run lock", async () => {
        await writeLock(process.pid);
        expect((await acquireLoopLock(state, 4242, NOW)).ok).toBe(true);
    });
});

describe("loopIsAlive", () => {
    it("is false without a loop lock and writes nothing", async () => {
        expect(await loopIsAlive(state, NOW)).toBe(false);
        expect(await readdir(state)).toEqual([]);
    });

    it("is true while a live process holds the loop lock", async () => {
        await acquireLoopLock(state, process.pid, NOW);
        expect(await loopIsAlive(state, NOW)).toBe(true);
    });

    it("is false when the owner is dead, and leaves the file", async () => {
        await writeFile(
            join(state, "loop.lock"),
            JSON.stringify({ pid: DEAD, startedAt: "2026-10-17T11:00:00.000Z" }),
        );
        expect(await loopIsAlive(state, NOW)).toBe(false);
        expect(await readdir(state)).toEqual(["loop.lock"]);
    });

    it("ignores the run lock", async () => {
        await writeLock(process.pid);
        expect(await loopIsAlive(state, NOW)).toBe(false);
    });
});

describe("readLoopLock", () => {
    const loopLock = () => join(state, "loop.lock");

    it("reports none without a loop lock and writes nothing", async () => {
        expect(await readLoopLock(state)).toEqual({ kind: "none" });
        expect(await readdir(state)).toEqual([]);
    });

    it("reports a live owner with its pid", async () => {
        await acquireLoopLock(state, process.pid, NOW);
        expect(await readLoopLock(state)).toEqual({ kind: "alive", pid: process.pid });
    });

    it("reports a dead owner with its pid, and leaves the file", async () => {
        await writeFile(loopLock(), JSON.stringify({ pid: DEAD, startedAt: NOW.toISOString() }));
        expect(await readLoopLock(state)).toEqual({ kind: "dead", pid: DEAD });
        expect(await readdir(state)).toEqual(["loop.lock"]);
    });

    it("reports a lock whose owner does not parse as ownerless, however old", async () => {
        await writeFile(loopLock(), "");
        const old = new Date(NOW.getTime() - 60_000);
        await utimes(loopLock(), old, old);
        expect(await readLoopLock(state)).toEqual({ kind: "ownerless" });
        expect(await readdir(state)).toEqual(["loop.lock"]);
    });

    it("ignores the run lock", async () => {
        await writeLock(process.pid);
        expect(await readLoopLock(state)).toEqual({ kind: "none" });
    });
});
