// The loop (spec autonomous-loop; design D5 to D7): holds the loop lock for its whole
// life and repeats an iteration, the interval apart. Every outcome of an iteration
// goes on; only a stop request or a thrown error ends it. Its standard output stays
// empty: each report goes to the log, and what the agent must hear to the notices: one
// summary line and its detail lines, written together at the end of the iteration.

import { acquireLoopLock } from "../attempts/lock.ts";
import { exitCodeFor, type RunReport } from "../report.ts";
import { appendLog, appendNotices, appendStuck, readStuck, startFiles } from "./files.ts";
import { iterationNotices, stopNotice, stuckNotices } from "./notices.ts";
import type { Wait } from "./signals.ts";
import type { FormatTime } from "./time.ts";

export interface LoopIo {
    state: string;
    json: boolean;
    now: () => Date;
    wait: Wait;
    stopSignal: () => AbortSignal; // called once the loop lock is held
    iterate: () => Promise<RunReport>; // one pipeline run, with the run lock
    render: (report: RunReport) => string; // the text report
    intervalMs: () => number;
    formatTime: FormatTime; // the user's locale and time zone
    stderr: (text: string) => void;
}

function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

// Returns the interval the loop then waits: the summary line's next time is read from the same value.
async function iteration(io: LoopIo): Promise<number> {
    const report = await io.iterate();
    await appendLog(io.state, io.json ? JSON.stringify(report) : `${io.render(report)}\n`);
    const stuck = stuckNotices(report, await readStuck(io.state));
    const ended = io.now();
    const interval = io.intervalMs();
    const times = {
        ended: io.formatTime(ended),
        next: io.formatTime(new Date(ended.getTime() + interval)),
    };
    await appendNotices(io.state, iterationNotices(report, stuck.notices, times));
    for (const entry of stuck.entries) {
        await appendStuck(io.state, entry);
    }
    return interval;
}

// A stop request ends the wait at once; during an iteration it is seen when the iteration ends.
async function repeat(io: LoopIo, stop: AbortSignal): Promise<string> {
    while (!stop.aborted) {
        const interval = await iteration(io);
        if (!stop.aborted) {
            await io.wait(interval, stop);
        }
    }
    return String(stop.reason);
}

async function run(io: LoopIo): Promise<number> {
    try {
        await startFiles(io.state);
        const reason = await repeat(io, io.stopSignal());
        await appendNotices(io.state, [stopNotice(io.formatTime(io.now()), reason)]);
        return 0;
    } catch (error) {
        const message = messageOf(error);
        io.stderr(`autonomous loop failed: ${message}`);
        await appendNotices(io.state, [
            stopNotice(io.formatTime(io.now()), `runner error: ${message}`),
        ]);
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
