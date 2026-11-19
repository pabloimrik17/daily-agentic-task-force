// Answers to the transition question (spec autonomous-run, "Transition answers"); the
// transition itself is ./apply.ts. The task is read again: its stage says which transition the
// answer is for.

import type { Answer } from "../args.ts";
import type { AnswerHandler } from "../answer-mode.ts";
import type { TaskRef } from "../attempts/record.ts";
import { isAutonomyLabel, isStageLabel } from "../label-contract/contract.ts";
import type { Tracker } from "../label-triage/trackers/tracker.ts";
import type { Wait } from "../read-back.ts";
import type { AnswerContext, AnswerRecord } from "../runner.ts";
import { applyTransition, type Settlement } from "./apply.ts";
import {
    accepts,
    AUTONOMY_OPTIONS,
    parseTransitionId,
    proposalAutonomy,
    rowOf,
    TRANSITION,
    type TransitionRow,
    TRANSITIONS,
} from "./mode.ts";
import { awaitedDetail, awaitedReceipt } from "./receipt.ts";
import { recordTransition } from "./transitioned.ts";

const VALUES: readonly string[] = [...AUTONOMY_OPTIONS, TRANSITIONS.proposal.to];

const INVALID_VALUE = `invalid for the transition: expected one of ${VALUES.join(", ")}`;

const list = (labels: readonly string[]) => `[${labels.join(", ")}]`;

interface Answering {
    tracker: Tracker;
    ref: TaskRef;
    row: TransitionRow;
    before: string[];
    value: string;
    state: string;
    wait: Wait | undefined;
    now: () => Date;
}

export function transitionHandler(
    state: string,
    wait?: Wait,
    now: () => Date = () => new Date(),
): AnswerHandler {
    return {
        id: TRANSITION,
        async answer(answers: readonly Answer[], ctx: AnswerContext): Promise<AnswerRecord[]> {
            const records: AnswerRecord[] = [];
            for (const answer of answers) {
                const { status, detail } = await settle(answer, ctx, state, wait, now);
                records.push({ id: answer.id, labels: [...answer.values], status, detail });
            }
            return records;
        },
    };
}

async function settle(
    answer: Answer,
    ctx: AnswerContext,
    state: string,
    wait: Wait | undefined,
    now: () => Date,
): Promise<Settlement> {
    const parsed = parseTransitionId(answer.id);
    if (!parsed.ok) {
        return { status: "rejected", detail: parsed.error };
    }
    const value = answeredValue(answer.values);
    if (value === null) {
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
    const row = rowOf(before);
    if (row === null || !accepts(row, value)) {
        return { status: "skipped", detail: `already moved on: stage ${list(stageOf(before))}` };
    }
    return transition({ tracker, ref, row, before, value, state, wait, now });
}

async function transition(answering: Answering): Promise<Settlement> {
    const { tracker, ref, row, before, value, state, wait } = answering;
    const awaited = await awaitedReceipt(state, ref, row.from);
    if (!awaited.ok) {
        return { status: "failed", detail: awaited.error };
    }
    if (awaited.value !== null) {
        return { status: "rejected", detail: awaitedDetail(awaited.value) };
    }
    const refused = refusal(answering);
    if (refused !== null) {
        return { status: "rejected", detail: refused };
    }
    const autonomy = isAutonomyLabel(value) ? value : undefined;
    const settled = await applyTransition({ tracker, ref, row, before, autonomy, wait });
    return leaveRecord(settled, answering);
}

// A task in proposal whose autonomy is missing or in conflict is not transitioned, whoever asks.
function refusal({ ref, row, before }: Answering): string | null {
    if (row.asks !== "approval") {
        return null;
    }
    const autonomy = proposalAutonomy(ref, before);
    return autonomy.ok ? null : autonomy.error;
}

// A failure to list or write the record is the settlement's detail, never its status.
async function leaveRecord(settled: Settlement, answering: Answering): Promise<Settlement> {
    if (settled.status !== "applied") {
        return settled;
    }
    const { state, ref, row, value, now } = answering;
    const failure = await recordTransition({
        state,
        ref,
        from: row.from,
        answer: [value],
        by: "human",
        at: now(),
    });
    return failure === null ? settled : { ...settled, detail: `${settled.detail}; ${failure}` };
}

function answeredValue(values: readonly string[]): string | null {
    const [value] = values;
    return values.length === 1 && value !== undefined && VALUES.includes(value) ? value : null;
}

const stageOf = (labels: readonly string[]) => labels.filter(isStageLabel);
