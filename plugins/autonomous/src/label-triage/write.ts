// Additive writes with read-back (spec label-triage, "Write only with
// --apply, additively, with read-back" and "Labels missing on a tracker are
// not written"): a write error, a read-back mismatch or a label listing that
// fails stops writes to that source for the rest of the run; the other sources
// keep going. A label the tracker lacks leaves its derivation proposed and the
// source keeps writing. The marks follow the same path; a removal of `triage-me`
// that fails stops nothing.

import { type TaskKey, taskKey } from "../attempts/record.ts";
import type { Source } from "../config.ts";
import { type Group, TRIAGE_LABEL } from "../label-contract/contract.ts";
import { isCompleteLabelSet, isMarked } from "../label-contract/detect.ts";
import { READ_BACK_TRIES, readUntil } from "../read-back.ts";
import type { Derivation } from "./rules.ts";
import type { Tracker, TrackerResult, TrackerTask, Trackers } from "./trackers/tracker.ts";

type RecordStatus = "applied" | "proposed" | "asked" | "failed";

export interface TriageRecord extends Derivation {
    status: RecordStatus;
    detail: string | null; // decide reason for asked; write failure text for failed; missing label for proposed
}

export interface WriteFailure {
    source: Source;
    taskId: string;
    labels: string[];
    before: string[];
    after: string[] | null; // null when readTask failed
    error: string;
}

// One task this run marked or unmarked with `triage-me` (spec label-triage, "Marks in the
// triage report"). `proposed`: without --apply, or the tracker lacks the label (detail
// names it and the bootstrap). `failed`: detail carries the error and the labels found.
export interface MarkRecord {
    source: Source;
    taskId: string;
    status: "applied" | "proposed" | "failed";
    detail: string | null;
}

// Whether the task's tracker has a label; `taskId` places a GitHub task in its repository.
export type LabelCheck = (label: string, taskId: string) => boolean;

export interface Written {
    records: TriageRecord[];
    failures: WriteFailure[];
    missing: string[]; // label-availability notes, each distinct one once
    marked: MarkRecord[]; // `triage-me` added, or proposed
    unmarked: MarkRecord[]; // `triage-me` removed, or proposed
}

const SOURCE_ORDER: readonly Source[] = ["beads", "github", "linear"];

// A write cut short leaves at worst an autonomy without its stage, which the next run
// completes by rule.
const GROUP_ORDER: readonly Group[] = ["scope", "autonomy", "stage"];

// Prefix of the error a read-back mismatch reports; the report renders it apart.
export const READ_BACK_MISMATCH = "read-back mismatch";

const BOOTSTRAP_HINT = "run --bootstrap-labels";

export function missingLabelDetail(label: string, source: Source): string {
    return `${label} is missing on ${source}; ${BOOTSTRAP_HINT}`;
}

// Beads creates labels by use and is never checked. Linear has a label in any scope,
// workspace or team; GitHub only in the task's own repository, whatever its letter case.
export async function labelCheckFor(tracker: Tracker): Promise<TrackerResult<LabelCheck>> {
    if (!tracker.createsLabels) {
        return { ok: true, value: () => true };
    }
    const listed = await tracker.listLabels();
    if (!listed.ok) {
        return listed;
    }
    const labels = listed.value;
    const perRepository = tracker.source === "github";
    return {
        ok: true,
        value: (name, taskId) =>
            labels.some(
                (label) =>
                    label.name === name &&
                    (!perRepository ||
                        label.scope.toLowerCase() === repositoryOf(taskId).toLowerCase()),
            ),
    };
}

// `owner/name#12` → `owner/name`.
function repositoryOf(taskId: string): string {
    const hash = taskId.indexOf("#");
    return hash === -1 ? taskId : taskId.slice(0, hash);
}

export async function applyDerivations(
    eligible: Derivation[],
    tasks: Map<TaskKey, TrackerTask>,
    trackers: Trackers,
    apply: boolean,
    // The unmarked tasks this run leaves for the human: each gets `triage-me` after its
    // other writes. A marked task in `tasks` that is complete loses it.
    toMark: ReadonlySet<TaskKey> = new Set(),
): Promise<Written> {
    const written: Written = { records: [], failures: [], missing: [], marked: [], unmarked: [] };
    // The listing's labels plus those this run has added, so a task's second derivation
    // expects the first one's labels in its read-back.
    const known = new Map<TaskKey, string[]>();
    const labelsBefore = (derivation: Derivation): string[] => {
        const key = taskKey(derivation.source, derivation.taskId);
        return known.get(key) ?? tasks.get(key)?.labels ?? [];
    };
    for (const source of SOURCE_ORDER) {
        const plan = planFor(source, eligible, tasks, toMark);
        if (plan.derivations.length + plan.toMark.length + plan.marked.length > 0) {
            const tracker = trackers[source];
            await (apply
                ? applySource(tracker, plan, labelsBefore, known, written)
                : previewSource(tracker, plan, written));
        }
    }
    return written;
}

// One source's share of the call. Without --apply the records list what would be written,
// in the order it would be.
interface SourcePlan {
    derivations: Derivation[];
    toMark: TrackerTask[]; // unmarked
    marked: TrackerTask[]; // carrying `triage-me`, removal candidates once their writes landed
}

function planFor(
    source: Source,
    eligible: readonly Derivation[],
    tasks: ReadonlyMap<TaskKey, TrackerTask>,
    toMark: ReadonlySet<TaskKey>,
): SourcePlan {
    const own = [...tasks].filter(([, task]) => task.source === source);
    return {
        derivations: inWriteOrder(eligible.filter((derivation) => derivation.source === source)),
        toMark: own
            .filter(([key, task]) => toMark.has(key) && !isMarked(task.labels))
            .map(([, task]) => task),
        marked: own.map(([, task]) => task).filter((task) => isMarked(task.labels)),
    };
}

function inWriteOrder(derivations: readonly Derivation[]): Derivation[] {
    const byTask = new Map<string, Derivation[]>();
    for (const derivation of derivations) {
        byTask.set(derivation.taskId, [...(byTask.get(derivation.taskId) ?? []), derivation]);
    }
    const rank = (derivation: Derivation) => GROUP_ORDER.indexOf(derivation.group);
    return [...byTask.values()].flatMap((own) => own.sort((a, b) => rank(a) - rank(b)));
}

const UNCHECKED: TrackerResult<LabelCheck> = { ok: true, value: () => true };

// Labels are listed only for a source with something to add; a removal needs no listing.
function checkFor(tracker: Tracker, plan: SourcePlan): Promise<TrackerResult<LabelCheck>> {
    return plan.derivations.length + plan.toMark.length === 0
        ? Promise.resolve(UNCHECKED)
        : labelCheckFor(tracker);
}

// The additive writes, then the marks, then the removals: a stop in either of the first two
// leaves every later mark and removal of the source proposed, naming the stop.
async function applySource(
    tracker: Tracker,
    plan: SourcePlan,
    labelsBefore: (derivation: Derivation) => string[],
    known: Map<TaskKey, string[]>,
    written: Written,
): Promise<void> {
    const check = await checkFor(tracker, plan);
    const writesStopped = await writeSource(
        tracker,
        plan.derivations,
        check,
        labelsBefore,
        known,
        written,
    );
    const labelsOf = (task: TrackerTask) => labelsAfter(task, written.records, true);
    const stopped =
        writesStopped || (await markTasks(tracker, plan.toMark, check, labelsOf, written));
    if (writesStopped) {
        skipMarks(plan.toMark, written.marked);
    }
    const complete = completeMarked(plan.marked, written.records, true);
    await (stopped
        ? skipMarks(complete, written.unmarked)
        : unmarkTasks(tracker, complete, labelsOf, written.unmarked));
}

// Returns whether the source stopped.
async function writeSource(
    tracker: Tracker,
    derivations: readonly Derivation[],
    check: TrackerResult<LabelCheck>,
    labelsBefore: (derivation: Derivation) => string[],
    known: Map<TaskKey, string[]>,
    written: Written,
): Promise<boolean> {
    for (const [index, derivation] of derivations.entries()) {
        const before = labelsBefore(derivation);
        const outcome = await writeChecked(tracker, check, derivation, before);
        if (outcome.ok) {
            const added = derivation.labels.filter((label) => !before.includes(label));
            known.set(taskKey(derivation.source, derivation.taskId), [...before, ...added]);
            written.records.push({ ...derivation, status: "applied", detail: null });
        } else if ("missing" in outcome) {
            written.records.push({ ...derivation, status: "proposed", detail: outcome.missing });
            note(written, outcome.missing);
        } else {
            fail(derivation, before, outcome, written);
            skipRest(derivations.slice(index + 1), written);
            return true;
        }
    }
    return false;
}

// The labels a write targets: a derivation's, or `triage-me` for a mark.
type WriteTarget = Pick<Derivation, "source" | "taskId" | "labels">;

async function writeChecked(
    tracker: Tracker,
    check: TrackerResult<LabelCheck>,
    target: WriteTarget,
    before: string[],
): Promise<
    | { ok: true }
    | { ok: false; missing: string }
    | { ok: false; error: string; after: string[] | null }
> {
    if (!check.ok) {
        return { ok: false, error: check.error, after: null };
    }
    const missing = missingDetailOf(check.value, target);
    if (missing !== null) {
        return { ok: false, missing };
    }
    return writeOne(tracker, target, before);
}

function missingDetailOf(check: LabelCheck, target: WriteTarget): string | null {
    const absent = target.labels.find((label) => !check(label, target.taskId));
    return absent === undefined ? null : missingLabelDetail(absent, target.source);
}

function note(written: Written, text: string): void {
    if (!written.missing.includes(text)) {
        written.missing.push(text);
    }
}

// Labels are listed even without --apply, so each derivation and mark shows what --apply
// would skip; a listing that fails here is only a note.
async function previewSource(tracker: Tracker, plan: SourcePlan, written: Written): Promise<void> {
    const check = await checkFor(tracker, plan);
    if (!check.ok) {
        note(written, `labels on ${tracker.source} could not be listed: ${check.error}`);
    }
    const proposedDetail = (target: WriteTarget): string | null => {
        const detail = check.ok ? missingDetailOf(check.value, target) : null;
        if (detail !== null) {
            note(written, detail);
        }
        return detail;
    };
    for (const derivation of plan.derivations) {
        written.records.push({
            ...derivation,
            status: "proposed",
            detail: proposedDetail(derivation),
        });
    }
    for (const task of plan.toMark) {
        written.marked.push(markRecord(task, "proposed", proposedDetail(markTarget(task))));
    }
    for (const task of completeMarked(plan.marked, written.records, false)) {
        written.unmarked.push(markRecord(task, "proposed", null));
    }
}

function fail(
    derivation: Derivation,
    before: string[],
    outcome: { error: string; after: string[] | null },
    written: Written,
): void {
    written.records.push({ ...derivation, status: "failed", detail: outcome.error });
    written.failures.push({
        source: derivation.source,
        taskId: derivation.taskId,
        labels: derivation.labels,
        before,
        after: outcome.after,
        error: outcome.error,
    });
}

function skipRest(derivations: readonly Derivation[], written: Written): void {
    for (const derivation of derivations) {
        written.records.push({
            ...derivation,
            status: "proposed",
            detail: skippedDetail(derivation.source),
        });
    }
}

function skippedDetail(source: Source): string {
    return `skipped after a write failure on ${source}`;
}

// Spec label-triage, "Mark the tasks left for the human": the same label check, additive
// write, read-back and per-source stop as a derivation. Returns whether the source stopped.
async function markTasks(
    tracker: Tracker,
    toMark: readonly TrackerTask[],
    check: TrackerResult<LabelCheck>,
    labelsOf: (task: TrackerTask) => string[],
    written: Written,
): Promise<boolean> {
    for (const [index, task] of toMark.entries()) {
        const target = markTarget(task);
        const before = labelsOf(task);
        const outcome = await writeChecked(tracker, check, target, before);
        if (outcome.ok) {
            written.marked.push(markRecord(task, "applied", null));
        } else if ("missing" in outcome) {
            written.marked.push(markRecord(task, "proposed", outcome.missing));
            note(written, outcome.missing);
        } else {
            written.marked.push(markRecord(task, "failed", outcome.error));
            written.failures.push({
                ...target,
                before,
                after: outcome.after,
                error: outcome.error,
            });
            skipMarks(toMark.slice(index + 1), written.marked);
            return true;
        }
    }
    return false;
}

function markTarget(task: TrackerTask): WriteTarget {
    return { source: task.source, taskId: task.id, labels: [TRIAGE_LABEL] };
}

function markRecord(
    task: TrackerTask,
    status: MarkRecord["status"],
    detail: string | null,
): MarkRecord {
    return { source: task.source, taskId: task.id, status, detail };
}

function skipMarks(tasks: readonly TrackerTask[], into: MarkRecord[]): void {
    for (const task of tasks) {
        into.push(markRecord(task, "proposed", skippedDetail(task.source)));
    }
}

// Spec label-triage, "Remove the mark from a complete task": every write this call made to
// the task landed (without --apply: would be made), and its labels with them are complete.
function completeMarked(
    marked: readonly TrackerTask[],
    records: readonly TriageRecord[],
    apply: boolean,
): TrackerTask[] {
    return marked.filter(
        (task) =>
            recordsOf(task, records).every((record) => landed(record, apply)) &&
            isCompleteLabelSet(labelsAfter(task, records, apply)),
    );
}

function labelsAfter(
    task: TrackerTask,
    records: readonly TriageRecord[],
    apply: boolean,
): string[] {
    const added = recordsOf(task, records)
        .filter((record) => landed(record, apply))
        .flatMap((record) => record.labels);
    return [...new Set([...task.labels, ...added])];
}

function recordsOf(task: TrackerTask, records: readonly TriageRecord[]): TriageRecord[] {
    return records.filter((record) => record.source === task.source && record.taskId === task.id);
}

function landed(record: TriageRecord, apply: boolean): boolean {
    return apply
        ? record.status === "applied"
        : record.status === "proposed" && record.detail === null;
}

async function unmarkTasks(
    tracker: Tracker,
    complete: readonly TrackerTask[],
    labelsOf: (task: TrackerTask) => string[],
    into: MarkRecord[],
): Promise<void> {
    for (const task of complete) {
        into.push(await removeMark(tracker, task, labelsOf(task)));
    }
}

// Spec label-triage, "A failed removal of the mark": reported with the labels found, and it
// stops nothing; the next run tries again.
async function removeMark(
    tracker: Tracker,
    task: TrackerTask,
    before: readonly string[],
): Promise<MarkRecord> {
    const removed = await tracker.removeLabel(task.id, TRIAGE_LABEL);
    if (!removed.ok) {
        return markRecord(task, "failed", `${removed.error} (labels [${before.join(", ")}])`);
    }
    const read = await readUntil(
        () => tracker.readTask(task.id),
        (found) => !isMarked(found.labels),
    );
    if (!read.ok) {
        return markRecord(task, "failed", read.error);
    }
    const after = read.value.labels;
    return isMarked(after)
        ? markRecord(
              task,
              "failed",
              `${TRIAGE_LABEL} still present after removal: [${after.join(", ")}] (${READ_BACK_TRIES})`,
          )
        : markRecord(task, "applied", null);
}

async function writeOne(
    tracker: Tracker,
    derivation: WriteTarget,
    before: string[],
): Promise<{ ok: true } | { ok: false; error: string; after: string[] | null }> {
    for (const [index, label] of derivation.labels.entries()) {
        const result = await tracker.addLabel(derivation.taskId, label);
        if (!result.ok) {
            if (index === 0) {
                return { ok: false, error: result.error, after: null };
            }
            const read = await tracker.readTask(derivation.taskId);
            return { ok: false, error: result.error, after: read.ok ? read.value.labels : null };
        }
    }
    const expected = [...before, ...derivation.labels];
    const read = await readUntil(
        () => tracker.readTask(derivation.taskId),
        (task) => hasAll(task.labels, expected),
    );
    if (!read.ok) {
        return { ok: false, error: read.error, after: null };
    }
    const after = read.value.labels;
    if (!hasAll(after, expected)) {
        return {
            ok: false,
            error: `${READ_BACK_MISMATCH}: before [${before.join(", ")}] + [${derivation.labels.join(", ")}] → after [${after.join(", ")}] (${READ_BACK_TRIES})`,
            after,
        };
    }
    return { ok: true };
}

function hasAll(labels: readonly string[], expected: readonly string[]): boolean {
    const found = new Set(labels);
    return expected.every((label) => found.has(label));
}
