// The loop (spec autonomous-loop; design D5 to D7): holds the loop lock for its whole
// life and repeats an iteration, the interval apart. Every outcome of an iteration
// goes on; only a stop request or a thrown error ends it. Its standard output stays
// empty: each report goes to the log, and what the agent must hear to the notices.

import { acquireLoopLock } from "../attempts/lock.ts";
import { exitCodeFor, type RunReport } from "../report.ts";
import { appendLog, appendNotices, startFiles } from "./files.ts";
import { iterationNotices, stopNotice } from "./notices.ts";
import type { Wait } from "./signals.ts";

export interface LoopIo {
    state: string;
    json: boolean;
    now: () => Date;
    wait: Wait;
    stopSignal: () => AbortSignal; // called once the loop lock is held
    iterate: () => Promise<RunReport>; // one pipeline run, with the run lock
    render: (report: RunReport) => string; // the text report
    intervalMs: () => number;
    stderr: (text: string) => void;
}

function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

async function iteration(io: LoopIo): Promise<void> {
    const report = await io.iterate();
    await appendLog(io.state, io.json ? JSON.stringify(report) : `${io.render(report)}\n`);
    await appendNotices(io.state, iterationNotices(report));
}

// A stop request ends the wait at once; during an iteration it is seen when the iteration ends.
async function repeat(io: LoopIo, stop: AbortSignal): Promise<string> {
    while (!stop.aborted) {
        await iteration(io);
        if (!stop.aborted) {
            await io.wait(io.intervalMs(), stop);
        }
    }
    return String(stop.reason);
}

async function run(io: LoopIo): Promise<number> {
    try {
        await startFiles(io.state);
        const reason = await repeat(io, io.stopSignal());
        await appendNotices(io.state, [stopNotice(reason)]);
        return 0;
    } catch (error) {
        const message = messageOf(error);
        io.stderr(`autonomous loop failed: ${message}`);
        await appendNotices(io.state, [stopNotice(`runner error: ${message}`)]);
        return 1;
    }
}

export async function runLoop(io: LoopIo): Promise<number> {
    const lock = await acquireLoopLock(io.state, process.pid, io.now());
    if (!lock.ok) {
        io.stderr(lock.error);
        return exitCodeFor("not-evaluable");
    }
    try {
        return await run(io);
    } finally {
        await lock.release();
    }
}
