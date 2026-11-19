// Applying a transition (spec label-contract, "A transition replaces the stage"), shared by
// answer mode and transition mode. Nothing besides the stage left and, when an autonomy is
// answered, the other autonomy is ever removed, aliases included.

import type { TaskRef } from "../attempts/record.ts";
import { type AutonomyLabel, isAutonomyLabel } from "../label-contract/contract.ts";
import type { Tracker, TrackerResult } from "../label-triage/trackers/tracker.ts";
import { labelCheckFor, missingLabelDetail, READ_BACK_MISMATCH } from "../label-triage/write.ts";
import { READ_BACK_TRIES, readUntil, type Wait } from "../read-back.ts";
import type { AnswerStatus } from "../runner.ts";
import type { TransitionRow } from "./mode.ts";

export interface Applying {
    tracker: Tracker;
    ref: TaskRef;
    row: TransitionRow;
    before: readonly string[];
    // Only the transition out of grill-me sets one.
    autonomy?: AutonomyLabel;
    wait?: Wait;
}

export type Settlement = { status: AnswerStatus; detail: string };

interface Moving {
    tracker: Tracker;
    ref: TaskRef;
    row: TransitionRow;
    before: string[];
    adds: string[]; // every label the transition adds, present already or not
    added: string[];
    removed: string[];
    wait?: Wait;
}

type Phase = (moving: Moving) => Promise<string | null>;

const NOTHING_REMOVED = "; nothing was removed";

const list = (labels: readonly string[]) => `[${labels.join(", ")}]`;

export async function applyTransition(applying: Applying): Promise<Settlement> {
    const moving = plan(applying);
    const phases: Phase[] = [checkLabels, addPhase, removePhase];
    for (const phase of phases) {
        const failure = await phase(moving);
        if (failure !== null) {
            return { status: "failed", detail: failure };
        }
    }
    return { status: "applied", detail: appliedDetail(moving) };
}

// The stage left goes last, so a removal cut short always leaves the task in it and
// a second try completes it.
function plan({ tracker, ref, row, before, autonomy, wait }: Applying): Moving {
    const adds = autonomy === undefined ? [row.to] : [autonomy, row.to];
    const added = adds.filter((label) => !before.includes(label));
    const replaced =
        autonomy === undefined
            ? []
            : before.filter((label) => isAutonomyLabel(label) && label !== autonomy);
    return {
        tracker,
        ref,
        row,
        before: [...before],
        adds,
        added,
        removed: [...replaced, row.from],
        wait,
    };
}

// One listing before any write; Beads is never checked.
async function checkLabels({ tracker, ref, adds }: Moving): Promise<string | null> {
    const check = await labelCheckFor(tracker);
    if (!check.ok) {
        return check.error;
    }
    const absent = adds.find((label) => !check.value(label, ref.id));
    return absent === undefined ? null : missingLabelDetail(absent, ref.source);
}

// Labels are added before any is removed, so a failure here leaves the stage in place.
async function addPhase(moving: Moving): Promise<string | null> {
    const { tracker, ref, before, added } = moving;
    for (const label of added) {
        const write = await tracker.addLabel(ref.id, label);
        if (!write.ok) {
            const after = await labelsNow(moving);
            return `${write.error} ${labelSets(before, after)}${NOTHING_REMOVED}`;
        }
    }
    const failure = await readBack(moving, []);
    return failure === null ? null : `${failure}${NOTHING_REMOVED}`;
}

async function removePhase(moving: Moving): Promise<string | null> {
    const { tracker, ref, before, removed } = moving;
    for (const label of removed) {
        const write = await tracker.removeLabel(ref.id, label);
        if (!write.ok) {
            const after = await labelsNow(moving);
            return `${write.error} ${labelSets(before, after)}${stillInStage(moving, after)}`;
        }
    }
    return readBack(moving, removed);
}

async function readLabels({ tracker, ref }: Moving): Promise<TrackerResult<string[]>> {
    const read = await tracker.readTask(ref.id);
    return read.ok ? { ok: true, value: read.value.labels } : read;
}

async function labelsNow(moving: Moving): Promise<string[] | null> {
    const read = await readLabels(moving);
    return read.ok ? read.value : null;
}

function labelSets(before: readonly string[], after: readonly string[] | null): string {
    return after === null
        ? `(before ${list(before)})`
        : `(before ${list(before)} → after ${list(after)})`;
}

function stillInStage({ row }: Moving, after: readonly string[] | null): string {
    return after === null || after.includes(row.from)
        ? `; ${row.from} may remain beside ${row.to}, answering again completes the transition`
        : "";
}

// The read-back is read again while the labels differ: the tracker's reads can lag its writes.
async function readBack(moving: Moving, removed: readonly string[]): Promise<string | null> {
    const { before, added, wait } = moving;
    const expected = new Set([...before, ...added].filter((label) => !removed.includes(label)));
    const read = await readUntil(
        () => readLabels(moving),
        (labels) => sameLabels(labels, expected),
        wait,
    );
    const after = read.ok ? read.value : null;
    const tail = removed.length === 0 ? "" : stillInStage(moving, after);
    if (!read.ok) {
        return `${read.error} ${labelSets(before, null)}${tail}`;
    }
    if (sameLabels(read.value, expected)) {
        return null;
    }
    const minus = removed.length === 0 ? "" : ` - ${list(removed)}`;
    return `${READ_BACK_MISMATCH}: before ${list(before)} + ${list(added)}${minus} → after ${list(read.value)} (${READ_BACK_TRIES})${tail}`;
}

function sameLabels(labels: readonly string[], expected: ReadonlySet<string>): boolean {
    const found = new Set(labels);
    return found.size === expected.size && [...expected].every((label) => found.has(label));
}

function appliedDetail({ ref, added, removed }: Moving): string {
    const parts = [
        ...(added.length === 0 ? [] : [`added ${added.join(", ")}`]),
        `removed ${removed.join(", ")}`,
    ];
    return `${parts.join(", ")} on ${ref.source} ${ref.id}, read back`;
}
