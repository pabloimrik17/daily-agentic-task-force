// `--notices <n>` (spec autonomous-loop, "Waiting for notices"; design D8): waits until
// the current loop has recorded more than `n` notices, or until no loop is alive.
// A waiter may start before the loop it follows has taken its lock, so finding no loop
// is decided only after a grace period, and the notices of an earlier loop are ignored
// while a new one is alive.

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { loopIsAlive } from "../attempts/lock.ts";
import { object, string } from "../validate.ts";
import { readNotices } from "./files.ts";
import type { Wait } from "./signals.ts";

export const NOTICES_POLL_MS = 2_000;

const GRACE_MS = 10_000;

const NOT_RUNNING_EXIT_CODE = 2;

export interface NoticesIo {
    state: string;
    now: () => Date;
    wait: Wait;
    stdout: (text: string) => void;
    graceMs?: number; // how long a missing loop is waited for; 10 s by default
}

// The start time the live loop recorded in its lock (the file of attempts/lock.ts);
// null when it cannot be read, and then no notice is taken as stale.
async function loopStartedAt(state: string): Promise<Date | null> {
    try {
        const owner = object(JSON.parse(await readFile(join(state, "loop.lock"), "utf8")), "$");
        const startedAt = new Date(string(owner, "startedAt", "$"));
        return Number.isNaN(startedAt.getTime()) ? null : startedAt;
    } catch {
        return null;
    }
}

// True when a loop is alive within the grace period.
async function awaitLoop(io: NoticesIo): Promise<boolean> {
    const grace = io.graceMs ?? GRACE_MS;
    for (let waited = 0; ; waited += NOTICES_POLL_MS) {
        if (await loopIsAlive(io.state, io.now())) {
            return true;
        }
        if (waited >= grace) {
            return false;
        }
        await io.wait(NOTICES_POLL_MS);
    }
}

// Prints the notices after the first `seen` with the new count; false when there are none.
function delivered(notices: readonly string[], seen: number, io: NoticesIo): boolean {
    if (notices.length <= seen) {
        return false;
    }
    io.stdout([...notices.slice(seen), `next: ${notices.length}`].join("\n"));
    return true;
}

function notRunning(io: NoticesIo): number {
    io.stdout("loop stopped: not running");
    return NOT_RUNNING_EXIT_CODE;
}

async function follow(seen: number, io: NoticesIo): Promise<number> {
    for (;;) {
        // Looked at before the notices: a loop writes its stop notice before it releases the lock.
        const alive = await loopIsAlive(io.state, io.now());
        const since = alive ? await loopStartedAt(io.state) : null;
        if (delivered(await readNotices(io.state, since), seen, io)) {
            return 0;
        }
        if (!alive) {
            return notRunning(io);
        }
        await io.wait(NOTICES_POLL_MS);
    }
}

export async function waitForNotices(seen: number, io: NoticesIo): Promise<number> {
    if (await awaitLoop(io)) {
        return follow(seen, io);
    }
    return delivered(await readNotices(io.state), seen, io) ? 0 : notRunning(io);
}
