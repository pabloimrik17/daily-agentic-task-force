import { readFile, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { acquireLock } from "./lock.ts";
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
