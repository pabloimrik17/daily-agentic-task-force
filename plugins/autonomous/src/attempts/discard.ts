// Discard mode (spec stage-sessions, "Discard mode", "Discard by task id";
// design D11): the one way a person releases an attempt. In order it removes
// the session (saving its capture and the agent's conversation id first),
// removes `taken` from the task and marks the attempt discarded; with
// `--release-workspace` it then releases the worktree. The first failure stops
// the discard, and the report says what was already done.

import { writeFile } from "node:fs/promises";

import type { RunArgs } from "../args.ts";
import type { Trackers } from "../label-triage/trackers/tracker.ts";
import type { SessionManager } from "../sessions/manager.ts";
import type { WorkspaceManager } from "../workspace/manager.ts";
import {
    type AttemptRecord,
    holdsTask,
    parseAttemptId,
    parseTaskRef,
    type TaskRef,
} from "./record.ts";
import {
    attemptDir,
    capturePath,
    listRecords,
    readRecord,
    recordPath,
    writeRecord,
} from "./state.ts";
import { removeTaken } from "./taken.ts";

export const DISCARD_SCHEMA = "autonomous.discard.v1";

export interface DiscardDeps {
    state: string;
    sessions: SessionManager;
    workspace: WorkspaceManager;
    trackers: Trackers;
    now: () => Date;
}

export interface DiscardReport {
    schema: typeof DISCARD_SCHEMA;
    startedAt: string;
    outcome: "advance" | "not-evaluable";
    attempt: string | null; // the attempt id resolved, null when none
    task: TaskRef | null;
    found: string[]; // attempt ids found when the task reference resolved to 0 or several
    removed: { session: boolean; taken: boolean; workspace: boolean };
    reasons: string[];
    // `path` and `error` only when the configuration failed to load, leaving nothing
    // to discard; `defaulted` only when keys took a shipped default, as in the run report.
    config?: { path?: string; error?: string; defaulted?: string[] };
}

type Resolved =
    | { ok: true; record: AttemptRecord }
    | { ok: false; reason: string; found: string[] };

interface Discarding {
    record: AttemptRecord;
    deps: DiscardDeps;
    report: DiscardReport;
    releaseWorkspace: boolean;
    conversation: string | null; // the agent's conversation id, saved before the session goes
}

// A step returns the reason it failed, or null when it did its part.
type DiscardStep = (discarding: Discarding) => Promise<string | null>;

const CAPTURE_LINES = 200;

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

const unresolved = (reason: string, found: string[] = []): Resolved => ({
    ok: false,
    reason,
    found,
});

function blank(startedAt: Date): DiscardReport {
    return {
        schema: DISCARD_SCHEMA,
        startedAt: startedAt.toISOString(),
        outcome: "not-evaluable",
        attempt: null,
        task: null,
        found: [],
        removed: { session: false, taken: false, workspace: false },
        reasons: [],
    };
}

export async function discardAttempt(
    args: RunArgs,
    deps: DiscardDeps,
    startedAt: Date,
): Promise<DiscardReport> {
    const report = blank(startedAt);
    const target = await resolve(args.discard ?? "", deps.state);
    if (!target.ok) {
        return { ...report, found: target.found, reasons: [target.reason] };
    }
    const { record } = target;
    report.attempt = record.id;
    report.task = { source: record.task.source, id: record.task.id };
    const discarding = {
        record,
        deps,
        report,
        releaseWorkspace: args.releaseWorkspace,
        conversation: null,
    };
    const steps: DiscardStep[] = [removeSession, removeTakenLabel, markDiscarded, releaseWorktree];
    for (const step of steps) {
        const failure = await step(discarding);
        if (failure !== null) {
            report.reasons.push(failure);
            return report;
        }
    }
    report.outcome = "advance";
    return report;
}

// With --json a configuration that fails to load still yields one document.
export function unconfiguredDiscard(path: string, error: string, startedAt: Date): DiscardReport {
    return { ...blank(startedAt), reasons: [error], config: { path, error } };
}

export function withDefaults(report: DiscardReport, defaulted: string[]): DiscardReport {
    return defaulted.length === 0 ? report : { ...report, config: { defaulted } };
}

async function resolve(value: string, state: string): Promise<Resolved> {
    if (parseAttemptId(value) !== null) {
        return byAttempt(value, state);
    }
    const ref = parseTaskRef(value);
    if (ref !== null) {
        return byTask(ref, value, state);
    }
    return unresolved(`not an attempt or task reference: ${value}`);
}

async function byAttempt(id: string, state: string): Promise<Resolved> {
    let record: AttemptRecord;
    try {
        record = await readRecord(recordPath(attemptDir(state, id)));
    } catch (error) {
        const missing = (error as { cause?: { code?: string } }).cause?.code === "ENOENT";
        return unresolved(missing ? `attempt ${id} not found` : messageOf(error));
    }
    if (record.state === "discarded") {
        return unresolved(`attempt ${id} is already discarded`);
    }
    return holdsTask(record)
        ? { ok: true, record }
        : unresolved(`attempt ${id} is ${record.state}; nothing to discard`);
}

async function byTask(ref: TaskRef, value: string, state: string): Promise<Resolved> {
    let records: AttemptRecord[];
    try {
        records = await listRecords(state);
    } catch (error) {
        return unresolved(messageOf(error));
    }
    const ofTask = records.filter(
        (record) => record.task.source === ref.source && record.task.id === ref.id,
    );
    const found = ofTask.map((record) => record.id);
    const open = ofTask.filter(holdsTask);
    const [only] = open;
    if (open.length === 1 && only !== undefined) {
        return { ok: true, record: only };
    }
    const reason =
        open.length === 0
            ? `no open attempt of ${value}`
            : `${open.length} open attempts of ${value}: ${open.map((r) => r.id).join(", ")}`;
    return unresolved(reason, found);
}

// The capture beside the record, while the session still exists; a failure is
// reported, never fatal.
async function saveCapture({ record, deps, report }: Discarding, id: string): Promise<void> {
    const captured = await deps.sessions.capture(id, CAPTURE_LINES);
    if (!captured.ok) {
        report.reasons.push(`capture of session ${id} failed: ${captured.error}`);
        return;
    }
    try {
        await writeFile(capturePath(attemptDir(deps.state, record.id)), captured.value);
    } catch (error) {
        report.reasons.push(`saving the capture of session ${id} failed: ${messageOf(error)}`);
    }
}

async function removeSession(discarding: Discarding): Promise<string | null> {
    const { record, deps, report } = discarding;
    const id = record.session?.id ?? null;
    if (id === null) {
        report.reasons.push("no session recorded");
        return null;
    }
    const observed = await deps.sessions.observe(id);
    if (!observed.ok) {
        return `observing session ${id} failed: ${observed.error}; nothing was changed`;
    }
    if (observed.value.state === "gone") {
        report.reasons.push(`session ${id} was already gone`);
        return null;
    }
    discarding.conversation = observed.value.agentSessionId;
    await saveCapture(discarding, id);
    const removal = await deps.sessions.remove(id);
    if (!removal.ok) {
        return `removing session ${id} failed: ${removal.error}; nothing was changed`;
    }
    report.removed.session = true;
    report.reasons.push(`session ${id} removed`);
    return null;
}

async function removeTakenLabel({ record, deps, report }: Discarding): Promise<string | null> {
    const { source, id } = record.task;
    const removal = await removeTaken(deps.trackers[source], id);
    if (!removal.ok) {
        const session = report.removed.session ? "; the session was already removed" : "";
        return `removing taken from ${source}:${id} failed: ${removal.error}${session}`;
    }
    report.removed.taken = true;
    report.reasons.push(`taken removed from ${source}:${id}`);
    return null;
}

async function markDiscarded({
    record,
    deps,
    report,
    conversation,
}: Discarding): Promise<string | null> {
    const at = deps.now().toISOString();
    const { session } = record;
    const discarded: AttemptRecord = {
        ...record,
        session:
            session === null
                ? null
                : { ...session, agentSessionId: conversation ?? session.agentSessionId },
        state: "discarded",
        history: [...record.history, { state: "discarded", at }],
        taken: { ...record.taken, removed: at },
        cleanup: null, // discarding the attempt settles the cleanup it still owed
    };
    try {
        await writeRecord(deps.state, discarded);
    } catch (error) {
        return `writing attempt ${record.id} failed: ${messageOf(error)}; taken was already removed`;
    }
    report.reasons.push(`attempt ${record.id} discarded`);
    return null;
}

async function releaseWorktree({
    record,
    deps,
    report,
    releaseWorkspace,
}: Discarding): Promise<string | null> {
    if (!releaseWorkspace) {
        return null;
    }
    const { repository, branch, path } = record.workspace;
    const release = await deps.workspace.release(repository, branch);
    if (!release.ok) {
        return `releasing worktree ${path} failed: ${release.error}; the attempt is already discarded`;
    }
    report.removed.workspace = true;
    report.reasons.push(`worktree ${path} released`);
    return null;
}

export function renderDiscardJson(report: DiscardReport): string {
    return JSON.stringify(report, null, 2);
}

export function renderDiscardText(report: DiscardReport): string {
    const { session, taken, workspace } = report.removed;
    const yesNo = (done: boolean) => (done ? "yes" : "no");
    return [
        `autonomous discard — started ${report.startedAt}`,
        `outcome: ${report.outcome}`,
        ...(report.config?.defaulted === undefined
            ? []
            : [`defaults: ${report.config.defaulted.join(", ")}`]),
        ...(report.attempt === null ? [] : [`attempt: ${report.attempt}`]),
        ...(report.task === null ? [] : [`task: ${report.task.source}:${report.task.id}`]),
        `removed: session ${yesNo(session)}, taken ${yesNo(taken)}, workspace ${yesNo(workspace)}`,
        ...(report.found.length === 0 ? [] : ["found:", ...report.found.map((id) => `  ${id}`)]),
        "reasons:",
        ...report.reasons.map((reason) => `  ${reason}`),
    ].join("\n");
}
