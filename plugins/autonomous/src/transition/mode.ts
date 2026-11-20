// Transition mode (spec autonomous-run, "Transition mode", "Transition question", "Approval
// question", "Transition report"). It writes only for an AFK task leaving a stage left on
// approval, proposal or implement; every other answer comes back through answer mode
// (./answer.ts).

import { isSource, taskKey, type TaskRef } from "../attempts/record.ts";
import type { AutonomousConfig, Source } from "../config.ts";
import {
    type AutonomyLabel,
    GROUPS,
    isAutonomyLabel,
    MEANINGS,
    type StageLabel,
} from "../label-contract/contract.ts";
import type { Trackers } from "../label-triage/trackers/tracker.ts";
import type { Wait } from "../read-back.ts";
import { buildHandoff, type Handoff, renderHandoffLine } from "../report.ts";
import type { Result } from "../result.ts";
import type { HandoffOption, HandoffQuestion } from "../runner.ts";
import { applyTransition } from "./apply.ts";
import { type GuardTools, guardsOnLeaving } from "./guards.ts";
import { awaitedDetail, awaitedReceipt } from "./receipt.ts";
import { recordTransition } from "./transitioned.ts";

export const TRANSITION = "transition";

const TRANSITION_SCHEMA = "autonomous.transition.v1";

// The transitions (spec label-contract, "A transition replaces the stage"), keyed by the stage
// they leave; `asks` names the question that leads out of it.
type TransitionQuestion = "autonomy" | "approval";

interface TransitionTarget {
    to: StageLabel;
    asks: TransitionQuestion;
}

const TRANSITIONS = {
    "grill-me": { to: "proposal", asks: "autonomy" },
    proposal: { to: "implement", asks: "approval" },
    implement: { to: "verify", asks: "approval" },
} as const satisfies Partial<Record<StageLabel, TransitionTarget>>;

export type TransitionStage = keyof typeof TRANSITIONS;

export interface TransitionRow extends TransitionTarget {
    from: TransitionStage;
}

export function transitionRow(from: TransitionStage): TransitionRow {
    return { from, ...TRANSITIONS[from] };
}

const TRANSITION_STAGES = Object.keys(TRANSITIONS) as TransitionStage[];

// Table order: a task a cut-short transition left with grill-me beside proposal is still in
// grill-me, so answering again completes that transition.
export function rowOf(labels: readonly string[]): TransitionRow | null {
    const from = TRANSITION_STAGES.find((stage) => labels.includes(stage));
    return from === undefined ? null : transitionRow(from);
}

// An autonomy answers the way out of grill-me; the next stage approves the way out of the others.
export function accepts(row: TransitionRow, value: string): boolean {
    return row.asks === "autonomy" ? isAutonomyLabel(value) : value === row.to;
}

export const AUTONOMY_OPTIONS: readonly AutonomyLabel[] = GROUPS.autonomy.filter(isAutonomyLabel);

// What an approval answers with: the stage each approval row leads to.
export const APPROVAL_VALUES: readonly StageLabel[] = TRANSITION_STAGES.map(transitionRow)
    .filter((row) => row.asks === "approval")
    .map((row) => row.to);

// The autonomy that decides how a task leaves a stage left on approval, `proposal` or `implement`
// (spec label-contract, "The autonomy decides whether leaving ... needs an answer"): exactly one,
// or the reason there is none.
export function stageAutonomy(
    ref: TaskRef,
    labels: readonly string[],
    stage: TransitionStage,
): Result<AutonomyLabel> {
    const found = labels.filter(isAutonomyLabel);
    const [only] = found;
    if (found.length === 1 && only !== undefined) {
        return { ok: true, value: only };
    }
    const expected = `expected one of ${AUTONOMY_OPTIONS.join(", ")}`;
    const problem =
        found.length === 0 ? "has no autonomy" : `has conflicting autonomy [${found.join(", ")}]`;
    return { ok: false, error: `${ref.source} ${ref.id} in ${stage} ${problem}: ${expected}` };
}

interface TransitionTask {
    source: Source;
    id: string;
    title: string;
    labels: string[];
}

export interface TransitionReport {
    schema: typeof TRANSITION_SCHEMA;
    startedAt: string;
    // advance exactly when a handoff is emitted or the transition was applied
    outcome: "advance" | "not-evaluable";
    applied: boolean; // true only for an AFK task the mode moved out of a stage left on approval
    task: TransitionTask | null; // null when the task was not read
    reasons: string[];
    handoff?: Handoff;
    // Present only when the configuration failed to load, leaving nothing to read.
    config?: { path: string; error: string };
}

export interface TransitionDeps extends GuardTools {
    config: AutonomousConfig;
    trackers: Trackers;
    state: string; // where the attempts are read, without the run lock
    wait?: Wait;
    now?: () => Date;
}

const MAX_HEADER = 12;

const later = (from: TransitionStage): HandoffOption => ({
    label: "Later",
    value: null,
    description: `Leave the task in ${from}`,
});

const CURRENT = "current · ";

// What the question says about the stage it asks to leave.
const READY: Record<TransitionStage, string> = {
    "grill-me": "the grill is over",
    proposal: "the proposal is ready",
    implement: "the implementation is ready",
};

// Task ids carry no `:`.
export function transitionQuestionId(ref: TaskRef): string {
    return `${TRANSITION}:${taskKey(ref.source, ref.id)}`;
}

export function parseTransitionId(
    id: string,
): { ok: true; ref: TaskRef } | { ok: false; error: string } {
    const prefix = `${TRANSITION}:`;
    const rest = id.startsWith(prefix) ? id.slice(prefix.length) : "";
    const colon = rest.indexOf(":");
    if (colon === -1) {
        return {
            ok: false,
            error: `malformed transition id ${id}: expected ${TRANSITION}:<source>:<task>`,
        };
    }
    const source = rest.slice(0, colon);
    const taskId = rest.slice(colon + 1);
    if (!isSource(source)) {
        return { ok: false, error: `unknown source ${source} in ${id}` };
    }
    if (taskId === "") {
        return { ok: false, error: `malformed transition id ${id}: no task` };
    }
    return { ok: true, ref: { source, id: taskId } };
}

function blank(startedAt: Date): TransitionReport {
    return {
        schema: TRANSITION_SCHEMA,
        startedAt: startedAt.toISOString(),
        outcome: "not-evaluable",
        applied: false,
        task: null,
        reasons: [],
    };
}

export async function runTransition(
    ref: TaskRef,
    deps: TransitionDeps,
    startedAt: Date,
): Promise<TransitionReport> {
    const report = blank(startedAt);
    if (!deps.config.sources[ref.source].enabled) {
        return { ...report, reasons: [`${ref.source} is not enabled`] };
    }
    const read = await deps.trackers[ref.source].readTask(ref.id);
    if (!read.ok) {
        return { ...report, reasons: [read.error] };
    }
    const { source, id, title, labels } = read.value;
    const task: TransitionTask = { source, id, title, labels: [...labels] };
    const row = rowOf(labels);
    if (row === null) {
        const reason = `${source} ${id} is in none of ${stageList()} (labels [${labels.join(", ")}])`;
        return { ...report, task, reasons: [reason] };
    }
    const awaited = await awaitedReceipt(deps.state, ref, row.from);
    if (!awaited.ok) {
        return { ...report, task, reasons: [awaited.error] };
    }
    if (awaited.value !== null) {
        return { ...report, task, reasons: [awaitedDetail(awaited.value)] };
    }
    if (row.asks === "autonomy") {
        return asking(report, task, transitionQuestion(ref, task));
    }
    return leaveStage({ ...report, task }, { ref, row, task }, deps);
}

// "grill-me, proposal and implement"
function stageList(): string {
    const last = TRANSITION_STAGES.at(-1);
    return `${TRANSITION_STAGES.slice(0, -1).join(", ")} and ${last}`;
}

function asking(
    report: TransitionReport,
    task: TransitionTask,
    question: HandoffQuestion,
): TransitionReport {
    return { ...report, outcome: "advance", task, handoff: buildHandoff([question]) };
}

async function leaveStage(
    report: TransitionReport,
    { ref, row, task }: { ref: TaskRef; row: TransitionRow; task: TransitionTask },
    deps: TransitionDeps,
): Promise<TransitionReport> {
    const autonomy = stageAutonomy(ref, task.labels, row.from);
    if (!autonomy.ok) {
        return { ...report, reasons: [autonomy.error] };
    }
    // Unfinished work is refused before the human is asked to approve it, and before a write.
    const unfinished = await guardsOnLeaving(row.from, ref, deps.state, deps);
    if (unfinished.length > 0) {
        return { ...report, reasons: unfinished };
    }
    if (autonomy.value === "HITL") {
        return asking(report, task, approvalQuestion(ref, task, row));
    }
    const tracker = deps.trackers[ref.source];
    const settled = await applyTransition({
        tracker,
        ref,
        row,
        before: task.labels,
        wait: deps.wait,
    });
    if (settled.status !== "applied") {
        return { ...report, reasons: [settled.detail] };
    }
    const failure = await recordTransition({
        state: deps.state,
        ref,
        from: row.from,
        answer: [row.to],
        by: "agent",
        at: (deps.now ?? (() => new Date()))(),
    });
    // A record that cannot be written costs the logbook its answer, not the transition.
    const reasons = failure === null ? [] : [failure];
    // The read-back confirmed exactly these labels, so the report shows the task as it is now.
    const labels = [
        ...task.labels.filter((label) => label !== row.from && label !== row.to),
        row.to,
    ];
    return { ...report, task: { ...task, labels }, outcome: "advance", applied: true, reasons };
}

// With --json a configuration that fails to load still yields one document;
// the error itself goes to stderr.
export function unconfiguredTransition(
    path: string,
    error: string,
    startedAt: Date,
): TransitionReport {
    return { ...blank(startedAt), config: { path, error } };
}

function header(task: TransitionTask, beyond: string): string {
    return task.id.length <= MAX_HEADER ? task.id : beyond;
}

const labelsLine = (task: TransitionTask) => `Labels: [${task.labels.join(", ")}]`;

// Only the autonomy is asked: the scope is a property the grill does not change,
// and the stage follows the answer.
function transitionQuestion(ref: TaskRef, task: TransitionTask): HandoffQuestion {
    const options = AUTONOMY_OPTIONS.map((label): HandoffOption => {
        const current = task.labels.includes(label) ? CURRENT : "";
        return { label, value: label, description: `${current}${MEANINGS[label]}` };
    });
    return {
        id: transitionQuestionId(ref),
        step: TRANSITION,
        header: header(task, "autonomy"),
        question: [
            `${task.source} ${task.id} "${task.title}": ${READY["grill-me"]}. Which autonomy does the task keep?`,
            labelsLine(task),
        ].join("\n"),
        options: [...options, later("grill-me")],
        multiSelect: false,
    };
}

// The approval changes no autonomy and no scope: it only lets the task leave the stage.
function approvalQuestion(ref: TaskRef, task: TransitionTask, row: TransitionRow): HandoffQuestion {
    const { from, to } = row;
    return {
        id: transitionQuestionId(ref),
        step: TRANSITION,
        header: header(task, "approval"),
        question: [
            `${task.source} ${task.id} "${task.title}": ${READY[from]}. Approve it to move the task to ${to}?`,
            labelsLine(task),
        ].join("\n"),
        options: [
            { label: "Approve", value: to, description: `Move the task to ${to}` },
            later(from),
        ],
        multiSelect: false,
    };
}

export function renderTransitionJson(report: TransitionReport): string {
    return JSON.stringify(report, null, 2);
}

// The handoff line, when present, is the last line.
export function renderTransitionText(report: TransitionReport): string {
    const header = [
        `autonomous transition — started ${report.startedAt}`,
        `outcome: ${report.outcome}`,
    ];
    if (report.config !== undefined) {
        return header.join("\n");
    }
    return [
        ...header,
        ...(report.applied ? ["applied: true"] : []),
        taskLine(report.task),
        ...(report.reasons.length === 0
            ? []
            : ["reasons:", ...report.reasons.map((reason) => `  - ${reason}`)]),
        ...(report.handoff === undefined ? [] : [renderHandoffLine(report.handoff)]),
    ].join("\n");
}

function taskLine(task: TransitionTask | null): string {
    if (task === null) {
        return "task: unreadable";
    }
    return `task: ${task.source} ${task.id} → "${task.title}" → labels [${task.labels.join(", ")}]`;
}
