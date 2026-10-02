// Answers to triage questions (spec label-triage, "Apply answers to triage
// questions"; handoff design D5): each answer is validated against its
// question's group and the task is read again, so only a group still missing
// is written. The survivors go through the step's own additive write with
// read-back and per-source stop. The answer wins over the evidence and the
// judgement the run had, and whether the task is still open is never checked.

import type { Answer } from "../args.ts";
import { isValidGroup } from "../label-contract/contract.ts";
import { detect } from "../label-contract/detect.ts";
import type { AnswerContext, AnswerRecord, AnswerStatus } from "../runner.ts";
import { violation } from "./decide.ts";
import { parseQuestionId, questionId } from "./question-id.ts";
import type { Derivation } from "./rules.ts";
import type { TrackerTask } from "./trackers/tracker.ts";
import {
    applyDerivations,
    READ_BACK_MISMATCH,
    taskKey,
    type TriageRecord,
    type WriteFailure,
} from "./write.ts";

// An answer settled before any write, or one to write with the task just read.
type Checked = { record: AnswerRecord } | { derivation: Derivation; task: TrackerTask };

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
        if ("derivation" in entry) {
            derivations.push(entry.derivation);
            tasks.set(taskKey(entry.task.source, entry.task.id), entry.task);
        }
    }
    const written = await applyDerivations(derivations, tasks, ctx.trackers, true);
    // Records come back grouped by source, so they are matched to answers by id.
    const byId = new Map(
        written.records.map((record) => [questionId(record), fromWrite(record, written.failures)]),
    );
    return checked.map((entry) => ("record" in entry ? entry.record : lookUp(byId, entry)));
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
    if (!isValidGroup(group, answer.values)) {
        return settle("rejected", `invalid for ${group}: ${violation(group, answer.values)}`);
    }
    const read = await ctx.trackers[source].readTask(taskId);
    if (!read.ok) {
        return settle("failed", read.error);
    }
    const state = detect(read.value, rules).groups[group];
    if (state.status !== "missing") {
        const found = state.status === "present" ? "already present" : "in conflict";
        return settle("skipped", `${group} ${found}: ${state.labels.join(", ")}`);
    }
    return {
        derivation: {
            source,
            taskId,
            title: read.value.title,
            group,
            labels: [...answer.values],
            confidence: 1,
            reason: "answered by the user",
            tier: "human",
        },
        task: read.value,
    };
}

// applyDerivations returns one record per derivation, so a missing one is a bug here.
function lookUp(
    byId: ReadonlyMap<string, AnswerRecord>,
    entry: { derivation: Derivation },
): AnswerRecord {
    const id = questionId(entry.derivation);
    const record = byId.get(id);
    if (record === undefined) {
        throw new Error(`no write record for answer ${id}`);
    }
    return record;
}

function fromWrite(record: TriageRecord, failures: readonly WriteFailure[]): AnswerRecord {
    const base = { id: questionId(record), labels: record.labels };
    if (record.status === "applied") {
        const added = record.labels.join(", ");
        return {
            ...base,
            status: "applied",
            detail: `added ${added} to ${record.source} ${record.taskId}, read back`,
        };
    }
    if (record.status === "failed") {
        return { ...base, status: "failed", detail: failedDetail(record, failures) };
    }
    // `proposed`: an earlier write to the same source failed, so this one never ran.
    return {
        ...base,
        status: "failed",
        detail: `not written after a write failure on ${record.source}`,
    };
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
