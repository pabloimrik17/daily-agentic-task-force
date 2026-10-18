// The reconcile step (spec stage-sessions, "The reconcile step" to "Manual
// sessions are untouched"; design D8). Without `--apply` it writes nothing. It
// acts only on session ids recorded in an attempt, and never waits.

import { writeFile } from "node:fs/promises";

import { plural } from "../label-triage/render.ts";
import type { TrackerTask, Trackers } from "../label-triage/trackers/tracker.ts";
import type { Result } from "../result.ts";
import type { RunContext, Step, StepResult } from "../runner.ts";
import type { Observed, SessionManager } from "../sessions/manager.ts";
import { STAGES } from "../stages/registry.ts";
import type { StageId } from "../stages/stage.ts";
import type { AttemptId, AttemptRecord, AttemptSession, AttemptState } from "./record.ts";
import { renderReconcile } from "./reconcile-render.ts";
import { readMarker } from "./result.ts";
import { attemptDir, capturePath, listRecords, resultPath, writeRecord } from "./state.ts";
import { removeTaken } from "./taken.ts";

const RECONCILE = "reconcile";

const CAPTURE_LINES = 200;

export type ReconcileAction =
    | "none"
    | "adopted"
    | "aborted"
    | "ambiguous"
    | "started"
    | "observed"
    | "completing"
    | "finalised"
    | "retained"
    | "cleanup-pending"
    | "cleanup-cleared";

export interface ReconciledAttempt {
    id: AttemptId;
    before: AttemptState;
    state: AttemptState; // equal to `before` without --apply
    session: {
        state: Observed["state"];
        status: string;
        busy: boolean;
        needsHuman: boolean;
    } | null; // null when not observed
    marker: { ok: true } | { ok: false; reason: string } | null; // null when not checked
    action: ReconcileAction; // what was done; without --apply what would be done
    detail: string | null; // the retention reason, the cleanup error, the adopted id…
}

export interface ReconcileData {
    attempts: ReconciledAttempt[]; // every record, sorted by id
    retained: AttemptId[];
    cleanups: AttemptId[]; // ids completed with cleanup still pending
    needsHuman: AttemptId[]; // ids whose session is open and needs a person
    errors: string[]; // manager/tracker command failures, one per attempt that hit one
}

const EMPTY: ReconcileData = {
    attempts: [],
    retained: [],
    cleanups: [],
    needsHuman: [],
    errors: [],
};

interface Reconciled {
    attempt: ReconciledAttempt;
    record: AttemptRecord;
    error: string | null;
}

interface Reconciler {
    apply: boolean;
    at: string;
    state: string;
    sessions: SessionManager;
    trackers: Trackers;
}

function result(
    outcome: StepResult["outcome"],
    reasons: string[],
    data: ReconcileData,
): StepResult<ReconcileData> {
    return { step: RECONCILE, tier: "code", outcome, reasons, data };
}

function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export const reconcileStep: Step<ReconcileData> = {
    id: RECONCILE,
    async run(ctx) {
        if (!ctx.config.ok) {
            return result("not-evaluable", [ctx.config.error], EMPTY);
        }
        let records: AttemptRecord[];
        try {
            records = await listRecords(ctx.io.state);
        } catch (error) {
            return result("not-evaluable", [messageOf(error)], EMPTY);
        }
        if (records.length === 0) {
            return result("advance", ["nothing to reconcile"], EMPTY);
        }
        const { config } = ctx.config;
        const reconciler = {
            apply: ctx.args.apply,
            at: ctx.now.toISOString(),
            state: ctx.io.state,
            sessions: ctx.io.sessions(config),
            trackers: ctx.io.trackers(config),
        };
        const done: Reconciled[] = [];
        for (const record of records) {
            done.push(await reconcile(reconciler, record));
        }
        return summarise(done, ctx);
    },
    render: renderReconcile,
};

function reconcile(r: Reconciler, record: AttemptRecord): Promise<Reconciled> {
    if (record.state === "pending") {
        return reconcilePending(r, record);
    }
    if (record.state === "created") {
        return reconcileCreated(r, record);
    }
    if (record.state === "started") {
        return reconcileStarted(r, record);
    }
    if (record.state === "completed" && record.cleanup !== null) {
        return reconcileCleanup(r, record, record.cleanup.error);
    }
    return Promise.resolve(reported(record, record, { action: "none" }));
}

function reported(
    before: AttemptRecord,
    after: AttemptRecord,
    parts: Partial<ReconciledAttempt> & { action: ReconcileAction },
    error: string | null = null,
): Reconciled {
    return {
        attempt: {
            id: before.id,
            before: before.state,
            state: after.state,
            session: null,
            marker: null,
            detail: null,
            ...parts,
        },
        record: after,
        error,
    };
}

function failed(
    record: AttemptRecord,
    error: string,
    parts: Partial<ReconciledAttempt> = {},
): Reconciled {
    return reported(
        record,
        record,
        { ...parts, action: "none", detail: error },
        `${record.id}: ${error}`,
    );
}

async function save(
    r: Reconciler,
    record: AttemptRecord,
    changes: Partial<AttemptRecord>,
): Promise<AttemptRecord> {
    const next = { ...record, ...changes };
    if (next.state !== record.state) {
        next.history = [...record.history, { state: next.state, at: r.at }];
    }
    await writeRecord(r.state, next);
    return next;
}

function sessionId(record: AttemptRecord): string | null {
    return record.session?.id ?? null;
}

const noSession = (record: AttemptRecord) => `record in state ${record.state} names no session`;

async function reconcilePending(r: Reconciler, record: AttemptRecord): Promise<Reconciled> {
    // The launch writes the session block, then `taken`, then creates the session:
    // without either, it stopped before creating anything.
    if (record.session === null || record.taken.added === null) {
        return abort(r, record);
    }
    const found = await r.sessions.findByPath(record.workspace.path);
    if (!found.ok) {
        return failed(record, found.error);
    }
    // Only a session the runner created is a candidate: the title recorded
    // before `create` narrows the path match, and never identifies one alone.
    const { title } = record.session;
    const ids = found.value.filter((listed) => listed.title === title).map(({ id }) => id);
    const [first, ...others] = ids;
    if (first === undefined) {
        return abort(r, record);
    }
    if (others.length > 0) {
        return ambiguous(r, record, ids);
    }
    return adopt(r, record, record.session, first);
}

async function adopt(
    r: Reconciler,
    record: AttemptRecord,
    session: AttemptSession,
    id: string,
): Promise<Reconciled> {
    const after = r.apply
        ? await save(r, record, { state: "created", session: { ...session, id } })
        : record;
    return reported(record, after, { action: "adopted", detail: id });
}

// `taken` is removed whatever `taken.added` holds: an add whose command timed out
// or whose save was lost can reach the task unrecorded, and the label has no owner.
async function abort(r: Reconciler, record: AttemptRecord): Promise<Reconciled> {
    if (!r.apply) {
        return reported(record, record, { action: "aborted" });
    }
    const removed = await removeTaken(r.trackers[record.task.source], record.task.id);
    if (!removed.ok) {
        return failed(record, removed.error);
    }
    const after = await save(r, record, {
        state: "aborted",
        taken: { ...record.taken, removed: r.at },
    });
    return reported(record, after, { action: "aborted" });
}

async function ambiguous(r: Reconciler, record: AttemptRecord, ids: string[]): Promise<Reconciled> {
    const reason = `${ids.length} sessions share ${record.workspace.path}: ${ids.join(", ")}`;
    const after = r.apply
        ? await save(r, record, { state: "retained", retained: { at: r.at, reason } })
        : record;
    return reported(record, after, { action: "ambiguous", detail: reason });
}

async function reconcileCreated(r: Reconciler, record: AttemptRecord): Promise<Reconciled> {
    const id = sessionId(record);
    if (id === null) {
        return failed(record, noSession(record));
    }
    if (!r.apply) {
        return reported(record, record, { action: "started" });
    }
    const started = await r.sessions.start(id);
    if (!started.ok) {
        return failed(record, started.error);
    }
    const after = await save(r, record, { state: "started" });
    return reported(record, after, { action: "started" });
}

interface Proofs {
    marker: { ok: true } | { ok: false; reason: string };
    holds: boolean;
    failure: string | null; // why the proofs do not hold
    error: string | null; // the tracker read that failed
}

async function checkProofs(r: Reconciler, record: AttemptRecord): Promise<Proofs> {
    const read = await readMarker(resultPath(attemptDir(r.state, record.id)), record.id);
    if (!read.ok) {
        const marker = { ok: false as const, reason: read.reason };
        return { marker, holds: false, failure: read.reason, error: null };
    }
    const marker = { ok: true as const };
    const task = await r.trackers[record.task.source].readTask(record.task.id);
    if (!task.ok) {
        return { marker, holds: false, failure: null, error: task.error };
    }
    const failure = stageCheck(record.stage, task.value);
    return { marker, holds: failure === null, failure, error: null };
}

// null when the stage's own tracker check holds; an unregistered stage never does.
function stageCheck(stage: StageId, task: TrackerTask): string | null {
    const implementation = STAGES.get(stage);
    if (implementation === undefined) {
        return `stage ${stage} has no implementation`;
    }
    return implementation.completed(task) ? null : `stage ${stage} check does not hold`;
}

type Decision = "finalise" | "completing" | "retain" | "observe";

// Spec "Finalisation" and "Retained attempts": a busy agent is never finalised,
// and an observed state never completes an attempt by itself.
function decide(observed: Observed, holds: boolean): Decision {
    if (holds) {
        return observed.busy ? "completing" : "finalise";
    }
    return observed.state === "open" ? "observe" : "retain";
}

const DRY_ACTIONS: Record<Decision, ReconcileAction> = {
    finalise: "finalised",
    completing: "completing",
    retain: "retained",
    observe: "observed",
};

function sessionView(observed: Observed): NonNullable<ReconciledAttempt["session"]> {
    const { state, status, busy, needsHuman } = observed;
    return { state, status, busy, needsHuman };
}

async function observeRecorded(
    r: Reconciler,
    record: AttemptRecord,
): Promise<{ ok: true; id: string; observed: Observed } | { ok: false; failure: Reconciled }> {
    const id = sessionId(record);
    if (id === null) {
        return { ok: false, failure: failed(record, noSession(record)) };
    }
    const seen = await r.sessions.observe(id);
    if (!seen.ok) {
        return { ok: false, failure: failed(record, seen.error) };
    }
    return { ok: true, id, observed: seen.value };
}

function removeUnlessGone(r: Reconciler, id: string, observed: Observed): Promise<Result<void>> {
    return observed.state === "gone"
        ? Promise.resolve({ ok: true, value: undefined })
        : r.sessions.remove(id);
}

async function reconcileStarted(r: Reconciler, record: AttemptRecord): Promise<Reconciled> {
    const seen = await observeRecorded(r, record);
    if (!seen.ok) {
        return seen.failure;
    }
    const { id, observed } = seen;
    const current = r.apply
        ? await save(r, record, { observed: observation(r, observed) })
        : record;
    const proofs = await checkProofs(r, record);
    const parts = { session: sessionView(observed), marker: proofs.marker };
    if (proofs.error !== null) {
        return failed(current, proofs.error, parts);
    }
    const decision = decide(observed, proofs.holds);
    if (!r.apply || decision === "completing" || decision === "observe") {
        return reported(record, current, { ...parts, action: DRY_ACTIONS[decision] });
    }
    const target = { record, current, id, observed, parts };
    return decision === "finalise" ? finalise(r, target) : retain(r, target, proofs.failure);
}

function observation(r: Reconciler, observed: Observed): AttemptRecord["observed"] {
    const { status, state, needsHuman } = observed;
    return { status, state, needsHuman, at: r.at };
}

interface Target {
    record: AttemptRecord; // as read from disk, for `before`
    current: AttemptRecord; // with the observation written
    id: string;
    observed: Observed;
    parts: Partial<ReconciledAttempt>;
}

async function saveCapture(
    r: Reconciler,
    record: AttemptRecord,
    target: Target,
): Promise<string[]> {
    if (target.observed.state === "gone") {
        return [];
    }
    const captured = await r.sessions.capture(target.id, CAPTURE_LINES);
    if (!captured.ok) {
        return [`capture failed: ${captured.error}`];
    }
    try {
        await writeFile(capturePath(attemptDir(r.state, record.id)), captured.value);
    } catch (error) {
        return [`saving the capture failed: ${messageOf(error)}`];
    }
    return [];
}

function joined(notes: string[]): string | null {
    return notes.length > 0 ? notes.join("; ") : null;
}

// Spec "Retained attempts": `taken` and the session are kept.
async function retain(r: Reconciler, target: Target, failure: string | null): Promise<Reconciled> {
    const { record, current, observed, parts } = target;
    const reason = `session ${observed.status}; ${failure ?? "stage not completed"}`;
    const notes = await saveCapture(r, current, target);
    const after = await save(r, current, { state: "retained", retained: { at: r.at, reason } });
    return reported(record, after, {
        ...parts,
        action: "retained",
        detail: joined([reason, ...notes]),
    });
}

// Spec "Finalisation" fixes the order: capture and conversation id, session
// removal, `completed`, then `taken` removal. A failed removal leaves the
// cleanup pending for every later run to retry (reconcileCleanup).
async function finalise(r: Reconciler, target: Target): Promise<Reconciled> {
    const { record, id, observed, parts } = target;
    const notes = await saveCapture(r, target.current, target);
    const current = await saveConversation(r, target.current, observed);
    const removed = await removeUnlessGone(r, id, observed);
    if (!removed.ok) {
        const cleanup = { pending: true as const, error: removed.error };
        const after = await save(r, current, { state: "completed", cleanup });
        return reported(record, after, {
            ...parts,
            action: "cleanup-pending",
            detail: joined([...notes, removed.error]),
        });
    }
    const completed = await save(r, current, { state: "completed" });
    const after = await releaseTaken(r, completed);
    const action = after.cleanup === null ? "finalised" : "cleanup-pending";
    return reported(record, after, {
        ...parts,
        action,
        detail: joined([...notes, ...(after.cleanup === null ? [] : [after.cleanup.error])]),
    });
}

// Written before the session is removed, so a crash after the removal still
// leaves the pointer; a gone session reports no id and the earlier one stays.
function saveConversation(
    r: Reconciler,
    record: AttemptRecord,
    observed: Observed,
): Promise<AttemptRecord> {
    const { session } = record;
    if (session === null) {
        return Promise.resolve(record);
    }
    const agentSessionId = observed.agentSessionId ?? session.agentSessionId;
    return save(r, record, { session: { ...session, agentSessionId } });
}

async function releaseTaken(r: Reconciler, record: AttemptRecord): Promise<AttemptRecord> {
    const removed = await removeTaken(r.trackers[record.task.source], record.task.id);
    if (!removed.ok) {
        return save(r, record, { cleanup: { pending: true, error: removed.error } });
    }
    return save(r, record, { cleanup: null, taken: { ...record.taken, removed: r.at } });
}

async function reconcileCleanup(
    r: Reconciler,
    record: AttemptRecord,
    error: string,
): Promise<Reconciled> {
    if (!r.apply) {
        return reported(record, record, { action: "cleanup-pending", detail: error });
    }
    const seen = await observeRecorded(r, record);
    if (!seen.ok) {
        return seen.failure;
    }
    const session = sessionView(seen.observed);
    const removed = await removeUnlessGone(r, seen.id, seen.observed);
    if (!removed.ok) {
        const after = await save(r, record, { cleanup: { pending: true, error: removed.error } });
        return reported(record, after, {
            session,
            action: "cleanup-pending",
            detail: removed.error,
        });
    }
    const after = await releaseTaken(r, record);
    return after.cleanup === null
        ? reported(record, after, { session, action: "cleanup-cleared" })
        : reported(record, after, {
              session,
              action: "cleanup-pending",
              detail: after.cleanup.error,
          });
}

function summarise(done: readonly Reconciled[], ctx: RunContext): StepResult<ReconcileData> {
    const attempts = done.map((entry) => entry.attempt);
    const ids = (keep: (entry: Reconciled) => boolean) =>
        done.filter(keep).map((entry) => entry.attempt.id);
    const data: ReconcileData = {
        attempts,
        retained: ids(({ record }) => record.state === "retained"),
        cleanups: ids(({ record }) => record.state === "completed" && record.cleanup !== null),
        needsHuman: ids(
            ({ attempt }) => attempt.session?.state === "open" && attempt.session.needsHuman,
        ),
        errors: done.flatMap((entry) => (entry.error === null ? [] : [entry.error])),
    };
    if (data.errors.length > 0) {
        return result("not-evaluable", data.errors, data);
    }
    return result("advance", counts(data, ctx.args.apply), data);
}

// The third element is what a dry run says instead.
const COUNTED: readonly [ReconcileAction, (count: number) => string, string][] = [
    ["adopted", (n) => `${n} adopted`, "would-adopt"],
    ["aborted", (n) => `${n} aborted`, "would-abort"],
    ["ambiguous", (n) => `${n} retained as ambiguous`, "would-retain as ambiguous"],
    ["started", (n) => `${n} started`, "would-start"],
    ["finalised", (n) => `${n} finalised`, "would-finalise"],
    ["retained", (n) => `${n} newly retained`, "would-retain"],
    ["cleanup-cleared", (n) => `${plural(n, "cleanup")} cleared`, "would-clear a cleanup"],
];

function counts(data: ReconcileData, apply: boolean): string[] {
    const { attempts } = data;
    const observed = attempts.filter((attempt) => attempt.session !== null).length;
    const reasons = observed > 0 ? [`${plural(observed, "attempt")} observed`] : [];
    for (const [action, done, would] of COUNTED) {
        const count = attempts.filter((attempt) => attempt.action === action).length;
        if (count > 0) {
            reasons.push(apply ? done(count) : `${count} ${would}`);
        }
    }
    reasons.push(...lists(data));
    if (attempts.every(unchanged)) {
        reasons.push("nothing changed");
    }
    return reasons;
}

// A cleared cleanup changes the record but not its state.
function unchanged(attempt: ReconciledAttempt): boolean {
    return attempt.state === attempt.before && attempt.action !== "cleanup-cleared";
}

function lists(data: ReconcileData): string[] {
    const reasons: string[] = [];
    if (data.retained.length > 0) {
        reasons.push(`${data.retained.length} retained`);
    }
    if (data.cleanups.length > 0) {
        reasons.push(`${plural(data.cleanups.length, "cleanup")} pending`);
    }
    const waiting = data.needsHuman.length;
    if (waiting > 0) {
        reasons.push(`${plural(waiting, "attempt")} ${waiting === 1 ? "needs" : "need"} a person`);
    }
    return reasons;
}
