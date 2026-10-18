import { readFile, rm, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { acquireLock } from "./lock.ts";
import { tempState } from "./test-fixtures.ts";

// Runs once, just before the next readFile: the window between acquire
// observing the lock and reading its contents.
const hook = vi.hoisted(() => ({ beforeRead: null as (() => Promise<void>) | null }));

vi.mock("node:fs/promises", async (importOriginal) => {
    const actual = await importOriginal<typeof import("node:fs/promises")>();
    return {
        ...actual,
        readFile: async (...args: Parameters<typeof actual.readFile>) => {
            const run = hook.beforeRead;
            hook.beforeRead = null;
            await run?.();
            return actual.readFile(...args);
        },
    };
});

const NOW = new Date("2026-10-17T12:00:00.000Z");

let state: string;
let file: string;

beforeEach(() => {
    state = tempState();
    file = join(state, "run.lock");
});

afterEach(async () => {
    hook.beforeRead = null;
    await rm(state, { recursive: true, force: true });
});

it("leaves a replacement lock that another run is still creating", async () => {
    await writeFile(file, "");
    const aged = new Date(NOW.getTime() - 60_000);
    await utimes(file, aged, aged);
    // Another run reclaims the stale lock and has created, but not yet
    // written, its own: as empty as the one acquire observed.
    hook.beforeRead = async () => {
        await rm(file);
        await writeFile(file, "");
    };
    expect(await acquireLock(state, 4242, NOW)).toEqual({
        ok: false,
        error: `another run holds ${file}`,
    });
    expect(await readFile(file, "utf8")).toBe("");
});
