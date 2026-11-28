// What an iteration tells the agent that started the loop (spec autonomous-loop, "Iteration
// summary line", "Detail lines"; design D3, D4): one summary line, then a detail line for each
// thing that happened. A session waiting for a person has no detail line.

import { parseAttemptId } from "../attempts/record.ts";
import type { LaunchData } from "../attempts/launch.ts";
import type { ReconciledAttempt, ReconcileData } from "../attempts/reconcile.ts";
import { LABEL_TRIAGE } from "../label-triage/question-id.ts";
import type { LabelTriageData } from "../label-triage/step.ts";
import type { RunReport } from "../report.ts";
import type { StepResult } from "../runner.ts";
import type { Excluded, Exclusion, SelectData } from "../select/types.ts";
import { stageFor } from "../stages/registry.ts";
import { isStageId } from "../stages/stage.ts";
import { type StuckEntry, UNREAD_ONCE } from "./files.ts";

const MARKS_NAMED = 5;
const DETAIL = "  ";

export interface NoticeTimes {
    ended: string; // already formatted, in the user's locale and zone
    next: string;
}

function finalised({ id, before, state, stageNow }: ReconciledAttempt): string[] {
    const parsed = parseAttemptId(id);
    if (before !== "started" || state !== "completed" || parsed === null) {
        return [];
    }
    const { task, stage } = parsed;
    return [
        `${DETAIL}✔ ${task.source}:${task.id} ${stage} → ${stageNow ?? "no single stage label"}`,
    ];
}

// Told once: only by the iteration that moves the attempt to retained.
function retained({ id, before, state, detail }: ReconciledAttempt): string[] {
    if (before === "retained" || state !== "retained") {
        return [];
    }
    return [`${DETAIL}⚠ retained ${id}: ${detail ?? "no reason recorded"}`];
}

// A proposed or failed mark changed nothing, and a task that already carried the label is
// not in `marked`.
function newlyMarked(report: RunReport): string[] {
    const triage = report.steps.find((result) => result.step === LABEL_TRIAGE);
    const marked = (triage?.data as LabelTriageData | undefined)?.marked ?? [];
    const applied = marked.filter(({ status }) => status === "applied");
    if (applied.length === 0) {
        return [];
    }
    const names = applied.slice(0, MARKS_NAMED).map(({ source, taskId }) => `${source}:${taskId}`);
    if (applied.length > MARKS_NAMED) {
        names.push("…");
    }
    return [`${DETAIL}⚠ triage-me +${applied.length}: ${names.join(", ")}`];
}

function stepData<D>(report: RunReport, step: string): D | undefined {
    return report.steps.find((result) => result.step === step)?.data as D | undefined;
}

// Only a launch that recorded its attempt (design D3).
function launchData(report: RunReport): Partial<LaunchData> | null {
    const launch = report.steps.find((result) => result.step === "launch");
    return launch?.outcome === "advance" && launch.data !== null
        ? (launch.data as Partial<LaunchData>)
        : null;
}

function launchedLine(report: RunReport): string | null {
    const { task, stage, attempt } = launchData(report) ?? {};
    if (!attempt || !task || !stage) {
        return null;
    }
    const emoji = isStageId(stage) ? stageFor(stage)?.emoji : undefined;
    return ["▶ launched", emoji, stage, `${task.source}:${task.id}`].filter(Boolean).join(" ");
}

// A step with no reason is named alone. A launch that advanced without an attempt (a dry run)
// launched nothing, and is named after the steps that stopped.
function notLaunched(report: RunReport): string {
    const step =
        report.steps.find((result) => result.outcome !== "advance") ??
        report.steps.find((result) => result.step === "launch");
    return step === undefined ? withoutStep(report) : stepLine(step);
}

function withoutStep({ outcome }: RunReport): string {
    return outcome === "not-evaluable" ? "✖ not evaluable" : "⏸ nothing to launch";
}

function stepLine({ step, outcome, reasons }: StepResult): string {
    const symbol = outcome === "not-evaluable" ? "✖ not evaluable" : "⏸ nothing to launch";
    return `${symbol}: ${[step, reasons[0]].filter(Boolean).join(": ")}`;
}

function whatHappened(report: RunReport): string {
    if (report.lock !== undefined) {
        return `✖ not evaluable: ${report.lock.error}`;
    }
    return launchedLine(report) ?? notLaunched(report);
}

// Told or not: the person is needed for every stuck task of the machine scope.
function needYou(report: RunReport): string {
    const data = stepData<SelectData>(report, "select");
    const count = (data?.excluded ?? []).filter(
        ({ stuck, scope }) => stuck && scope !== null && scope === data?.machineScope,
    ).length;
    return count === 0 ? "" : ` · ${count} need you`;
}

function summaryLine(report: RunReport, { ended, next }: NoticeTimes): string {
    return `${ended} ${whatHappened(report)}${needYou(report)} · next ${next}`;
}

// The summary line first, then the detail lines; `stuck` are the lines stuckNotices made.
export function iterationNotices(
    report: RunReport,
    stuck: readonly string[],
    times: NoticeTimes,
): string[] {
    const attempts = stepData<ReconcileData>(report, "reconcile")?.attempts ?? [];
    return [
        summaryLine(report, times),
        ...attempts.flatMap((attempt) => [...finalised(attempt), ...retained(attempt)]),
        ...newlyMarked(report),
        ...stuck,
    ];
}

// A changed exclusion, reason or scope is a new entry, so it is told again.
const sameEntry = (a: StuckEntry, b: StuckEntry) =>
    a.task === b.task &&
    a.exclusion === b.exclusion &&
    a.detail === b.detail &&
    (a.scope ?? null) === (b.scope ?? null);

function entryOf({ source, id, reason, detail, scope }: Excluded): StuckEntry {
    return { task: `${source}:${id}`, exclusion: reason, detail: detail ?? reason, scope };
}

export interface StuckTold {
    notices: string[];
    entries: StuckEntry[]; // every new stuck task of the iteration, of any scope, and its memory
}

function unrecorded(excluded: Excluded[], recorded: readonly StuckEntry[]): Excluded[] {
    const known = [...recorded];
    return excluded.filter((task) => {
        const entry = entryOf(task);
        const isNew = !known.some((other) => sameEntry(other, entry));
        known.push(entry);
        return isNew;
    });
}

// Only five are named, so the tasks a person can release soonest come first: a retained attempt
// or failing prerequisites, then a repository that lacks something, then no repository at all.
const NAMED_AFTER: Partial<Record<Exclusion, number>> = {
    "repository-prerequisites": 1,
    repository: 2,
};

function byUrgency(stuck: Excluded[]): Excluded[] {
    const rank = ({ reason }: Excluded) => NAMED_AFTER[reason] ?? 0;
    return stuck.toSorted((a, b) => rank(a) - rank(b));
}

// The task whose prerequisites made the iteration not evaluable, remembered and never told:
// select excludes it when they cannot be read again (design D9).
function unreadOnce(data: SelectData | undefined, recorded: readonly StuckEntry[]): StuckEntry[] {
    const unreadable = data?.unreadable ?? null;
    if (unreadable === null) {
        return [];
    }
    const { source, id, reason } = unreadable;
    const entry = { task: `${source}:${id}`, exclusion: UNREAD_ONCE, detail: reason };
    return recorded.some((other) => sameEntry(other, entry)) ? [] : [entry];
}

function stuckLines(told: StuckEntry[]): string[] {
    const lines = told
        .slice(0, MARKS_NAMED)
        .map(({ task, detail }) => `${DETAIL}⚠ stuck ${task}: ${detail}`);
    if (told.length > MARKS_NAMED) {
        lines.push(`${DETAIL}⚠ stuck +${told.length - MARKS_NAMED} more: see loop.log`);
    }
    return lines;
}

// An entry of another scope is recorded, never told: select reads the recorded
// prerequisites entries back whatever their scope (design D6).
export function stuckNotices(report: RunReport, recorded: readonly StuckEntry[]): StuckTold {
    const select = report.steps.find((result) => result.step === "select");
    const data = select?.data as SelectData | undefined;
    const fresh = unrecorded(
        (data?.excluded ?? []).filter(({ stuck }) => stuck),
        recorded,
    );
    const ofMachine = fresh.filter(({ scope }) => scope !== null && scope === data?.machineScope);
    return {
        notices: stuckLines(byUrgency(ofMachine).map(entryOf)),
        entries: [...fresh.map(entryOf), ...unreadOnce(data, recorded)],
    };
}

export function stopNotice(time: string, reason: string): string {
    return `${time} ■ loop stopped: ${reason}`;
}
