// Transition mode (spec autonomous-run, "Transition mode", "Transition
// question", "Transition report"; design D5, D7): reads one task and, when it
// is in `grill-me`, asks the human which autonomy it keeps. It never writes:
// the answer comes back through answer mode (./answer.ts). The handoff is
// rendered by the run report's own functions, so the command reads both alike.

import { isSource, type TaskRef } from "../attempts/record.ts";
import type { AutonomousConfig, Source } from "../config.ts";
import {
    type AutonomyLabel,
    GROUPS,
    isAutonomyLabel,
    MEANINGS,
    type StageLabel,
} from "../label-contract/contract.ts";
import type { Trackers } from "../label-triage/trackers/tracker.ts";
import { buildHandoff, type Handoff, renderHandoffLine } from "../report.ts";
import type { HandoffOption, HandoffQuestion } from "../runner.ts";

export const TRANSITION = "transition";

export const TRANSITION_SCHEMA = "autonomous.transition.v1";

// The only transition (spec label-contract, "A transition replaces the stage").
export const FROM_STAGE: StageLabel = "grill-me";
export const TO_STAGE: StageLabel = "proposal";

// The autonomy a transition answer may name.
export const AUTONOMY_OPTIONS: readonly AutonomyLabel[] = GROUPS.autonomy.filter(isAutonomyLabel);

export interface TransitionTask {
    source: Source;
    id: string;
    title: string;
    labels: string[];
}

export interface TransitionReport {
    schema: typeof TRANSITION_SCHEMA;
    startedAt: string;
    outcome: "advance" | "not-evaluable"; // advance exactly when a handoff is emitted (design D7)
    task: TransitionTask | null; // null when the task was not read
    reasons: string[];
    handoff?: Handoff;
    // Present only when the configuration failed to load, leaving nothing to read.
    config?: { path: string; error: string };
}

export interface TransitionDeps {
    config: AutonomousConfig;
    trackers: Trackers;
}

const MAX_HEADER = 12;

const LATER: HandoffOption = {
    label: "Later",
    value: null,
    description: `Leave the task in ${FROM_STAGE}`,
};

const CURRENT = "current · ";

// `transition:<source>:<task>`; task ids carry no `:` (design D5).
export function transitionQuestionId(ref: TaskRef): string {
    return `${TRANSITION}:${ref.source}:${ref.id}`;
}

// The task is everything after the second `:`.
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
    if (!labels.includes(FROM_STAGE)) {
        const reason = `${source} ${id} is not in ${FROM_STAGE} (labels [${labels.join(", ")}])`;
        return { ...report, task, reasons: [reason] };
    }
    const handoff = buildHandoff([transitionQuestion(ref, task)]);
    return { ...report, outcome: "advance", task, handoff };
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
        header: task.id.length <= MAX_HEADER ? task.id : "autonomy",
        question: [
            `${task.source} ${task.id} "${task.title}": the grill is over. Which autonomy does the task keep?`,
            `Labels: [${task.labels.join(", ")}]`,
        ].join("\n"),
        options: [...options, LATER],
        multiSelect: false,
    };
}

export function renderTransitionJson(report: TransitionReport): string {
    return JSON.stringify(report, null, 2);
}

// The handoff line, when present, is the last line (design D7).
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
