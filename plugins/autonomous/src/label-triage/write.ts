// Additive writes with read-back (spec label-triage, "Write only with
// --apply, additively, with read-back" and "Labels missing on a tracker are
// not written"): every write adds labels, never replaces or removes them, and
// is verified by reading the task back. A write error, a read-back mismatch or
// a label listing that fails stops writes to that source for the rest of the
// run; the other sources keep going. A label the tracker lacks is not written:
// its derivation stays proposed and the source keeps writing. Without --apply
// the same lookup runs read-only to preview what --apply would skip: a listing
// that fails there is a note, not a failure.

import type { Source } from "../config.ts";
import type { Group } from "../label-contract/contract.ts";
import type { Derivation } from "./rules.ts";
import type { Tracker, TrackerResult, TrackerTask, Trackers } from "./trackers/tracker.ts";

export type RecordStatus = "applied" | "proposed" | "asked" | "failed";

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

// Whether the task's tracker has a label; `taskId` places a GitHub task in its repository.
export type LabelCheck = (label: string, taskId: string) => boolean;

interface Written {
    records: TriageRecord[];
    failures: WriteFailure[];
    missing: string[]; // the label-availability notes, each distinct one once: a missingLabelDetail, or a dry run's failed listing
}

const SOURCE_ORDER: readonly Source[] = ["beads", "github", "linear"];

// A write cut short leaves at worst an autonomy without its stage, which the next run
// completes by rule.
const GROUP_ORDER: readonly Group[] = ["scope", "autonomy", "stage"];

// Prefix of the error a read-back mismatch reports; the report renders it apart.
export const READ_BACK_MISMATCH = "read-back mismatch";

export const BOOTSTRAP_HINT = "run --bootstrap-labels";

export function missingLabelDetail(label: string, source: Source): string {
    return `${label} is missing on ${source}; ${BOOTSTRAP_HINT}`;
}

export function taskKey(source: Source, id: string): string {
    return `${source}:${id}`;
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
    tasks: Map<string, TrackerTask>,
    trackers: Trackers,
    apply: boolean,
): Promise<{ records: TriageRecord[]; failures: WriteFailure[]; missing: string[] }> {
    // Without --apply the records list what would be written, in the order it would be.
    const bySource = SOURCE_ORDER.map((source) =>
        inWriteOrder(eligible.filter((derivation) => derivation.source === source)),
    );
    const written: Written = { records: [], failures: [], missing: [] };
    // The listing's labels plus those this run has added, so a task's second derivation
    // expects the first one's labels in its read-back.
    const known = new Map<string, string[]>();
    const labelsBefore = (derivation: Derivation): string[] => {
        const key = taskKey(derivation.source, derivation.taskId);
        return known.get(key) ?? tasks.get(key)?.labels ?? [];
    };
    for (const own of bySource) {
        const [first] = own;
        if (first !== undefined) {
            const tracker = trackers[first.source];
            await (apply
                ? writeSource(tracker, own, labelsBefore, known, written)
                : previewSource(tracker, own, written));
        }
    }
    return written;
}

function inWriteOrder(derivations: readonly Derivation[]): Derivation[] {
    const byTask = new Map<string, Derivation[]>();
    for (const derivation of derivations) {
        byTask.set(derivation.taskId, [...(byTask.get(derivation.taskId) ?? []), derivation]);
    }
    const rank = (derivation: Derivation) => GROUP_ORDER.indexOf(derivation.group);
    return [...byTask.values()].flatMap((own) => own.sort((a, b) => rank(a) - rank(b)));
}

async function writeSource(
    tracker: Tracker,
    derivations: readonly Derivation[],
    labelsBefore: (derivation: Derivation) => string[],
    known: Map<string, string[]>,
    written: Written,
): Promise<void> {
    const check = await labelCheckFor(tracker);
    for (const [index, derivation] of derivations.entries()) {
        const before = labelsBefore(derivation);
        const outcome = check.ok
            ? await writeChecked(tracker, check.value, derivation, before)
            : { ok: false as const, error: check.error, after: null };
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
            return;
        }
    }
}

async function writeChecked(
    tracker: Tracker,
    check: LabelCheck,
    derivation: Derivation,
    before: string[],
): Promise<
    | { ok: true }
    | { ok: false; missing: string }
    | { ok: false; error: string; after: string[] | null }
> {
    const missing = missingDetailOf(check, derivation);
    if (missing !== null) {
        return { ok: false, missing };
    }
    return writeOne(tracker, derivation, before);
}

function missingDetailOf(check: LabelCheck, derivation: Derivation): string | null {
    const absent = derivation.labels.find((label) => !check(label, derivation.taskId));
    return absent === undefined ? null : missingLabelDetail(absent, derivation.source);
}

function note(written: Written, text: string): void {
    if (!written.missing.includes(text)) {
        written.missing.push(text);
    }
}

// Labels are listed even without --apply, so each derivation shows what --apply would skip;
// a listing that fails here is only a note.
async function previewSource(
    tracker: Tracker,
    derivations: readonly Derivation[],
    written: Written,
): Promise<void> {
    const check = await labelCheckFor(tracker);
    if (!check.ok) {
        note(written, `labels on ${tracker.source} could not be listed: ${check.error}`);
    }
    for (const derivation of derivations) {
        const detail = check.ok ? missingDetailOf(check.value, derivation) : null;
        written.records.push({ ...derivation, status: "proposed", detail });
        if (detail !== null) {
            note(written, detail);
        }
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
            detail: `skipped after a write failure on ${derivation.source}`,
        });
    }
}

async function writeOne(
    tracker: Tracker,
    derivation: Derivation,
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
    const read = await tracker.readTask(derivation.taskId);
    if (!read.ok) {
        return { ok: false, error: read.error, after: null };
    }
    const after = read.value.labels;
    const afterSet = new Set(after);
    const expected = [...before, ...derivation.labels];
    if (!expected.every((label) => afterSet.has(label))) {
        return {
            ok: false,
            error: `${READ_BACK_MISMATCH}: before [${before.join(", ")}] + [${derivation.labels.join(", ")}] → after [${after.join(", ")}]`,
            after,
        };
    }
    return { ok: true };
}
