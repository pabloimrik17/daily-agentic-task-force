// Answers to triage questions (spec label-triage, "Apply answers to triage
// questions"; handoff design D5): each answer names its question's group, the
// task is read again, and the answer is checked against the options for the
// task's stage (design D2), so only a group still missing is written. An
// autonomy answer writes the stage that follows it (design D3). The survivors
// go through the step's own additive write with the label check, read-back and
// per-source stop. The answer wins over the evidence and the judgement the run
// had, and whether the task is still open is never checked.

import type { Answer } from "../args.ts";
import { type Group, isValidDecision } from "../label-contract/contract.ts";
import { detect, type Detection, type GroupState } from "../label-contract/detect.ts";
import type { AnswerContext, AnswerRecord, AnswerStatus } from "../runner.ts";
import { violation } from "./decide.ts";
import { parseQuestionId } from "./question-id.ts";
import { type Derivation, recordsForAutonomy } from "./rules.ts";
import type { TrackerTask } from "./trackers/tracker.ts";
import {
    applyDerivations,
    READ_BACK_MISMATCH,
    taskKey,
    type TriageRecord,
    type WriteFailure,
} from "./write.ts";

// An answer settled before any write, or the derivations to write for it with the task
// just read: the answered decision first, then the stage that follows it.
type Checked =
    | { record: AnswerRecord }
    | { answer: Answer; derivations: Derivation[]; task: TrackerTask };

interface Writes {
    byKey: ReadonlyMap<string, TriageRecord>;
    failures: readonly WriteFailure[];
    missing: readonly string[];
}

export async function answerLabelTriage(
    answers: readonly Answer[],
    ctx: AnswerContext,
): Promise<AnswerRecord[]> {
    const checked: Checked[] = [];
    for (const answer of answers) {
        checked.push(await check(answer, ctx));
    }
    const derivations: Derivation[] = [];
    const tasks = new Map<string, TrackerTask>();
    for (const entry of checked) {
        if ("derivations" in entry) {
            derivations.push(...entry.derivations);
            tasks.set(taskKey(entry.task.source, entry.task.id), entry.task);
        }
    }
    const written = await applyDerivations(derivations, tasks, ctx.trackers, true);
    // Records come back grouped by source and task; at most one answer per question id,
    // so a task and group name one record.
    const writes: Writes = {
        byKey: new Map(written.records.map((record) => [recordKey(record), record])),
        failures: written.failures,
        missing: written.missing,
    };
    return checked.map((entry) => ("record" in entry ? entry.record : fromWrites(entry, writes)));
}

async function check(answer: Answer, ctx: AnswerContext): Promise<Checked> {
    const settle = (status: AnswerStatus, detail: string): Checked => ({
        record: { id: answer.id, labels: [...answer.values], status, detail },
    });
    const parsed = parseQuestionId(answer.id);
    if (!parsed.ok) {
        return settle("rejected", parsed.error);
    }
    const { source, taskId, group } = parsed.target;
    const rules = ctx.config.sources[source];
    if (!rules.enabled) {
        return settle("rejected", `${source} is not enabled`);
    }
    const read = await ctx.trackers[source].readTask(taskId);
    if (!read.ok) {
        return settle("failed", read.error);
    }
    const task = read.value;
    const detection = detect(task, rules);
    const settled = settledByTask(group, answer.values, detection);
    if (settled !== undefined) {
        return settle(settled.status, settled.detail);
    }
    const decision: Derivation = {
        source,
        taskId,
        title: task.title,
        group,
        labels: [...answer.values],
        confidence: 1,
        reason: "answered by the user",
        tier: "human",
    };
    const derivations =
        group === "autonomy" ? recordsForAutonomy(decision, task.labels) : [decision];
    return { answer, derivations, task };
}

// Validity depends on the task's stage (design D2): a `grill-me` answer that only the
// stage set since the question makes invalid is skipped, naming the stage; any other
// invalid answer is rejected. A group no longer missing (a deferred autonomy included)
// is skipped, naming what was found.
function settledByTask(
    group: Group,
    values: readonly string[],
    detection: Detection,
): { status: AnswerStatus; detail: string } | undefined {
    const taskLabels = detection.task.labels;
    if (!isValidDecision(group, values, taskLabels)) {
        return isValidDecision(group, values, [])
            ? { status: "skipped", detail: found("stage", detection.groups.stage) }
            : {
                  status: "rejected",
                  detail: `invalid for ${group}: ${violation(group, values, taskLabels)}`,
              };
    }
    const state = detection.groups[group];
    return state.status === "missing"
        ? undefined
        : { status: "skipped", detail: found(group, state) };
}

// Never called for a missing group. A deferred autonomy waits for the task's grill (design D1).
function found(group: Group, state: GroupState): string {
    if (state.status === "conflict") {
        return `${group} in conflict: ${state.labels.join(", ")}`;
    }
    if (state.status === "present") {
        return `${group} already present: ${state.labels.join(", ")}`;
    }
    return `${group} deferred to the grill (grill-me)`;
}

function recordKey(derivation: Derivation): string {
    return `${taskKey(derivation.source, derivation.taskId)}:${derivation.group}`;
}

// The answer is applied only when every record it wrote was; otherwise the first record
// not applied says why. A label the tracker lacks fails the answer without stopping the
// source (design D4).
function fromWrites(
    entry: { answer: Answer; derivations: Derivation[]; task: TrackerTask },
    writes: Writes,
): AnswerRecord {
    const records = entry.derivations.map((derivation) => lookUp(writes.byKey, derivation));
    const base = { id: entry.answer.id, labels: [...entry.answer.values] };
    const unapplied = records.find((record) => record.status !== "applied");
    if (unapplied === undefined) {
        const added = records.flatMap((record) => record.labels).join(", ");
        return {
            ...base,
            status: "applied",
            detail: `added ${added} to ${entry.task.source} ${entry.task.id}, read back`,
        };
    }
    return { ...base, status: "failed", detail: unappliedDetail(unapplied, writes) };
}

// applyDerivations returns one record per derivation, so a missing one is a bug here.
function lookUp(byKey: ReadonlyMap<string, TriageRecord>, derivation: Derivation): TriageRecord {
    const record = byKey.get(recordKey(derivation));
    if (record === undefined) {
        throw new Error(`no write record for ${recordKey(derivation)}`);
    }
    return record;
}

function unappliedDetail(record: TriageRecord, writes: Writes): string {
    if (record.status === "failed") {
        return failedDetail(record, writes.failures);
    }
    if (record.detail !== null && writes.missing.includes(record.detail)) {
        return record.detail;
    }
    // `proposed`: an earlier write to the same source failed, so this one never ran.
    return `not written after a write failure on ${record.source}`;
}

// A read-back mismatch already names both label sets; any other error gets them appended.
function failedDetail(record: TriageRecord, failures: readonly WriteFailure[]): string {
    const error = record.detail ?? "";
    const failure = failures.find(
        (item) => item.source === record.source && item.taskId === record.taskId,
    );
    if (failure === undefined || error.startsWith(READ_BACK_MISMATCH)) {
        return error;
    }
    const after = failure.after === null ? "" : ` → after [${failure.after.join(", ")}]`;
    return `${error} (before [${failure.before.join(", ")}]${after})`;
}
