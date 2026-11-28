// The run lock (spec stage-sessions, "Run lock"; design D12) and the loop lock
// (spec autonomous-loop, "Loop lock"), which differ only by file name. A live
// holder fails the run at once; a lock whose process is gone is reclaimed by renaming
// it aside, as ghd-aoe does.

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { number, object, string } from "../validate.ts";

export type LockResult = { ok: true; release: () => Promise<void> } | { ok: false; error: string };

interface LockOwner {
    pid: number;
    startedAt: string;
}

interface Seen {
    text: string;
    owner: LockOwner | null; // null when the file does not parse
    mtimeMs: number;
    ino: number;
}

const OWNERLESS_GRACE_MS = 10_000;

const RUN_LOCK = "run.lock";
const LOOP_LOCK = "loop.lock";

function lockFile(state: string, name: string): string {
    return join(state, name);
}

function isAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        return (error as NodeJS.ErrnoException).code === "EPERM";
    }
}

function parseOwner(text: string): LockOwner | null {
    try {
        const json = object(JSON.parse(text), "$");
        const pid = number(json, "pid", "$");
        const startedAt = string(json, "startedAt", "$");
        return Number.isInteger(pid) && pid > 0 ? { pid, startedAt } : null;
    } catch {
        return null;
    }
}

// null when the file is gone.
async function look(file: string): Promise<Seen | null> {
    try {
        const { mtimeMs, ino } = await stat(file);
        const text = await readFile(file, "utf8");
        return { text, owner: parseOwner(text), mtimeMs, ino };
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            return null;
        }
        throw error;
    }
}

// True when this call created the file.
async function create(file: string, owner: LockOwner): Promise<boolean> {
    try {
        await writeFile(file, `${JSON.stringify(owner)}\n`, { flag: "wx" });
        return true;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") {
            return false;
        }
        throw error;
    }
}

// Renames a stale lock aside; false when what moved was not what was observed
// (another run took the lock in between), after putting it back. Contents
// alone cannot tell: a replacement still being created is as empty as a stale
// ownerless lock, so the file itself and its mtime must match too.
async function reclaim(file: string, observed: Seen): Promise<boolean> {
    const aside = `${file}.${process.pid}.${randomUUID()}.stale`;
    try {
        await rename(file, aside);
    } catch (error) {
        return (error as NodeJS.ErrnoException).code === "ENOENT";
    }
    const moved = await readFile(aside, "utf8").catch(() => "");
    const movedStat = await stat(aside).catch(() => null);
    if (
        moved === observed.text &&
        movedStat?.ino === observed.ino &&
        movedStat.mtimeMs === observed.mtimeMs
    ) {
        await rm(aside, { force: true });
        return true;
    }
    await rename(aside, file).catch(() => rm(aside, { force: true }));
    return false;
}

// A parsed owner holds the lock while its process lives; no owner means a
// creator that may still be writing, until the grace period has passed.
function holds(seen: Seen, now: Date): boolean {
    return seen.owner
        ? isAlive(seen.owner.pid)
        : now.getTime() - seen.mtimeMs <= OWNERLESS_GRACE_MS;
}

function heldBy(file: string, seen: Seen | null, holder: string): LockResult {
    const owner = seen?.owner;
    const who = owner ? ` (pid ${owner.pid}, started ${owner.startedAt})` : "";
    return { ok: false, error: `another ${holder} holds ${file}${who}` };
}

function releaser(file: string, pid: number): () => Promise<void> {
    return async () => {
        const seen = await look(file);
        if (seen?.owner?.pid === pid) {
            await rm(file, { force: true });
        }
    };
}

async function acquire(file: string, pid: number, now: Date, holder: string): Promise<LockResult> {
    const owner = { pid, startedAt: now.toISOString() };
    await mkdir(dirname(file), { recursive: true });
    if (await create(file, owner)) {
        return { ok: true, release: releaser(file, pid) };
    }
    const seen = await look(file);
    if (seen && holds(seen, now)) {
        return heldBy(file, seen, holder);
    }
    if (seen !== null && !(await reclaim(file, seen))) {
        return heldBy(file, await look(file), holder);
    }
    if (await create(file, owner)) {
        return { ok: true, release: releaser(file, pid) };
    }
    return heldBy(file, await look(file), holder);
}

export async function acquireLockAt(
    file: string,
    pid: number = process.pid,
    now: Date = new Date(),
    holder: string = "run",
): Promise<LockResult> {
    try {
        return await acquire(file, pid, now, holder);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { ok: false, error: `cannot take ${file}: ${message}` };
    }
}

export function acquireLock(state: string, pid?: number, now?: Date): Promise<LockResult> {
    return acquireLockAt(lockFile(state, RUN_LOCK), pid, now);
}

export function acquireLoopLock(state: string, pid?: number, now?: Date): Promise<LockResult> {
    return acquireLockAt(lockFile(state, LOOP_LOCK), pid, now, "loop");
}

// True while a live process holds the loop lock; never writes.
export async function loopIsAlive(state: string, now: Date = new Date()): Promise<boolean> {
    const seen = await look(lockFile(state, LOOP_LOCK));
    return seen !== null && holds(seen, now);
}

export type LoopLockRead =
    | { kind: "none" }
    | { kind: "alive"; pid: number }
    | { kind: "dead"; pid: number }
    | { kind: "ownerless" };

// What the loop lock says about its owner; never writes. An owner that does not parse
// is reported as such whatever the file's age, unlike `loopIsAlive`'s grace period.
export async function readLoopLock(state: string): Promise<LoopLockRead> {
    const seen = await look(lockFile(state, LOOP_LOCK));
    if (seen === null) {
        return { kind: "none" };
    }
    if (seen.owner === null) {
        return { kind: "ownerless" };
    }
    const { pid } = seen.owner;
    return { kind: isAlive(pid) ? "alive" : "dead", pid };
}
