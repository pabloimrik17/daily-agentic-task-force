// Answers to the transition question (spec autonomous-run, "Transition
// answers"; spec label-contract, "A transition replaces the stage"; design D6):
// the task is read again, the tracker's labels are checked before any write
// (design D4), then the answered autonomy and `proposal` are added and read
// back, and only then are the other autonomy and `grill-me` removed and the
// task read back again. Nothing else is ever removed, aliases included. Each
// answer writes one task, so a failure settles that answer alone.

import type { Answer } from "../args.ts";
import type { AnswerHandler } from "../answer-mode.ts";
import type { TaskRef } from "../attempts/record.ts";
import { type AutonomyLabel, isAutonomyLabel, isStageLabel } from "../label-contract/contract.ts";
import type { Tracker, TrackerResult } from "../label-triage/trackers/tracker.ts";
import { labelCheckFor, missingLabelDetail, READ_BACK_MISMATCH } from "../label-triage/write.ts";
import type { AnswerContext, AnswerRecord, AnswerStatus } from "../runner.ts";
import { AUTONOMY_OPTIONS, FROM_STAGE, parseTransitionId, TO_STAGE, TRANSITION } from "./mode.ts";

interface Moving {
    tracker: Tracker;
    ref: TaskRef;
    autonomy: AutonomyLabel;
    before: string[]; // the task's labels, read again for this answer
    added: string[]; // what phase 1 adds: the answered autonomy, then proposal, when absent
    removed: string[]; // what phase 2 removes: every other autonomy, then grill-me
}

type Settlement = { status: AnswerStatus; detail: string };

// A phase returns why it failed, or null when it did its part.
type Phase = (moving: Moving) => Promise<string | null>;

const INVALID_VALUE = `invalid for the transition: expected one of ${AUTONOMY_OPTIONS.join(", ")}`;

const NOTHING_REMOVED = "; nothing was removed";

// Design D6: a retry finds grill-me still there and only does what is left.
const ANSWER_AGAIN = `; ${FROM_STAGE} may remain beside ${TO_STAGE}, answering again completes the transition`;

const list = (labels: readonly string[]) => `[${labels.join(", ")}]`;

export const transitionHandler: AnswerHandler = {
    id: TRANSITION,
    async answer(answers: readonly Answer[], ctx: AnswerContext): Promise<AnswerRecord[]> {
        const records: AnswerRecord[] = [];
        for (const answer of answers) {
            const { status, detail } = await settle(answer, ctx);
            records.push({ id: answer.id, labels: [...answer.values], status, detail });
        }
        return records;
    },
};

async function settle(answer: Answer, ctx: AnswerContext): Promise<Settlement> {
    const parsed = parseTransitionId(answer.id);
    if (!parsed.ok) {
        return { status: "rejected", detail: parsed.error };
    }
    const autonomy = answeredAutonomy(answer.values);
    if (autonomy === null) {
        return { status: "rejected", detail: INVALID_VALUE };
    }
    const { ref } = parsed;
    if (!ctx.config.sources[ref.source].enabled) {
        return { status: "rejected", detail: `${ref.source} is not enabled` };
    }
    const tracker = ctx.trackers[ref.source];
    const read = await tracker.readTask(ref.id);
    if (!read.ok) {
        return { status: "failed", detail: read.error };
    }
    const before = [...read.value.labels];
    if (!before.includes(FROM_STAGE)) {
        return { status: "skipped", detail: `already moved on: stage ${list(stageOf(before))}` };
    }
    return move(plan(tracker, ref, autonomy, before));
}

function answeredAutonomy(values: readonly string[]): AutonomyLabel | null {
    const [value] = values;
    return values.length === 1 && value !== undefined && isAutonomyLabel(value) ? value : null;
}

const stageOf = (labels: readonly string[]) => labels.filter(isStageLabel);

// grill-me goes last, so a removal cut short always leaves the task in grill-me and
// a second answer completes it (design D6).
function plan(tracker: Tracker, ref: TaskRef, autonomy: AutonomyLabel, before: string[]): Moving {
    const added = [autonomy, TO_STAGE].filter((label) => !before.includes(label));
    const replaced = before.filter((label) => isAutonomyLabel(label) && label !== autonomy);
    return { tracker, ref, autonomy, before, added, removed: [...replaced, FROM_STAGE] };
}

async function move(moving: Moving): Promise<Settlement> {
    const phases: Phase[] = [checkLabels, addPhase, removePhase];
    for (const phase of phases) {
        const failure = await phase(moving);
        if (failure !== null) {
            return { status: "failed", detail: failure };
        }
    }
    return { status: "applied", detail: appliedDetail(moving) };
}

// Before any write (design D4): one listing; Beads is never checked.
async function checkLabels({ tracker, ref, autonomy }: Moving): Promise<string | null> {
    const check = await labelCheckFor(tracker);
    if (!check.ok) {
        return check.error;
    }
    const absent = [autonomy, TO_STAGE].find((label) => !check.value(label, ref.id));
    return absent === undefined ? null : missingLabelDetail(absent, ref.source);
}

// Labels are added before any is removed, so a failure here leaves grill-me in place.
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
            return `${write.error} ${labelSets(before, after)}${stillInGrill(after)}`;
        }
    }
    return readBack(moving, removed);
}

async function readLabels({ tracker, ref }: Moving): Promise<TrackerResult<string[]>> {
    const read = await tracker.readTask(ref.id);
    return read.ok ? { ok: true, value: read.value.labels } : read;
}

// The task's labels after a failed write, or null when it cannot be read either.
async function labelsNow(moving: Moving): Promise<string[] | null> {
    const read = await readLabels(moving);
    return read.ok ? read.value : null;
}

function labelSets(before: readonly string[], after: readonly string[] | null): string {
    return after === null
        ? `(before ${list(before)})`
        : `(before ${list(before)} → after ${list(after)})`;
}

function stillInGrill(after: readonly string[] | null): string {
    return after === null || after.includes(FROM_STAGE) ? ANSWER_AGAIN : "";
}

// The task must hold exactly before + added - removed, compared as sets.
async function readBack(moving: Moving, removed: readonly string[]): Promise<string | null> {
    const { before, added } = moving;
    const read = await readLabels(moving);
    const after = read.ok ? read.value : null;
    const tail = removed.length === 0 ? "" : stillInGrill(after);
    if (!read.ok) {
        return `${read.error} ${labelSets(before, null)}${tail}`;
    }
    const expected = new Set([...before, ...added].filter((label) => !removed.includes(label)));
    const found = new Set(read.value);
    if (found.size === expected.size && [...expected].every((label) => found.has(label))) {
        return null;
    }
    const minus = removed.length === 0 ? "" : ` - ${list(removed)}`;
    return `${READ_BACK_MISMATCH}: before ${list(before)} + ${list(added)}${minus} → after ${list(read.value)}${tail}`;
}

function appliedDetail({ ref, added, removed }: Moving): string {
    const parts = [
        ...(added.length === 0 ? [] : [`added ${added.join(", ")}`]),
        `removed ${removed.join(", ")}`,
    ];
    return `${parts.join(", ")} on ${ref.source} ${ref.id}, read back`;
}
