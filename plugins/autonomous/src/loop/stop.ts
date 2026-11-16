// `--stop-loop` (spec autonomous-loop, "Stopping the loop"; design D1 to D7): sends the
// live loop one SIGTERM, which the loop already turns into a clean stop, then waits a
// bounded time for it to end. Like `--notices` it reads only the loop's files: no
// configuration, no lock. Exactly one signal is sent, never repeated; a second one would
// kill the loop's process and could cut a launch. A stale lock is left in place for the
// next loop to reclaim.

import { loopIsAlive, readLoopLock } from "../attempts/lock.ts";
import type { Wait } from "./signals.ts";

export const STOP_POLL_MS = 250;
export const STOP_WAIT_MS = 10_000;

const NOT_RUNNING_EXIT_CODE = 2;
const FAILED_EXIT_CODE = 1;

export interface StopIo {
    state: string;
    now: () => Date;
    wait: Wait;
    stdout: (text: string) => void;
    stderr: (text: string) => void;
    signal: (pid: number) => void; // the real one is process.kill(pid, "SIGTERM"); it throws like it
}

function notRunning(io: StopIo): number {
    io.stdout("loop stopped: not running");
    return NOT_RUNNING_EXIT_CODE;
}

function failed(io: StopIo, message: string): number {
    io.stderr(message);
    return FAILED_EXIT_CODE;
}

function ownerless(io: StopIo): number {
    return failed(
        io,
        "cannot stop the loop: its lock names no owner (a loop still starting, or a damaged lock)",
    );
}

// Undefined when the signal was sent, otherwise the exit code.
function send(pid: number, io: StopIo): number | undefined {
    try {
        io.signal(pid);
        return undefined;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ESRCH") {
            return notRunning(io);
        }
        const message = error instanceof Error ? error.message : String(error);
        return failed(io, `cannot stop the loop (pid ${pid}): ${message}`);
    }
}

// Polls from the signal on; the last look is at the full wait.
async function afterSignal(io: StopIo): Promise<number> {
    for (let waited = 0; ; waited += STOP_POLL_MS) {
        if (!(await loopIsAlive(io.state, io.now()))) {
            io.stdout("loop stopped");
            return 0;
        }
        if (waited >= STOP_WAIT_MS) {
            io.stdout("loop stopping: the iteration in progress ends first");
            return 0;
        }
        await io.wait(STOP_POLL_MS);
    }
}

async function stopOwner(pid: number, io: StopIo): Promise<number> {
    return send(pid, io) ?? (await afterSignal(io));
}

export async function stopLoop(io: StopIo): Promise<number> {
    const lock = await readLoopLock(io.state);
    switch (lock.kind) {
        case "alive":
            return stopOwner(lock.pid, io);
        case "ownerless":
            return ownerless(io);
        default:
            return notRunning(io);
    }
}
