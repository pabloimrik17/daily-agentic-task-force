// What an iteration tells the agent that started the loop (spec autonomous-loop,
// "Notices"; design D7, D9). A launch or a session waiting for a person tells nothing.

import { parseAttemptId } from "../attempts/record.ts";
import type { ReconciledAttempt, ReconcileData } from "../attempts/reconcile.ts";
import { LABEL_TRIAGE } from "../label-triage/question-id.ts";
import type { LabelTriageData } from "../label-triage/step.ts";
import type { RunReport } from "../report.ts";
import type { Excluded, Exclusion, SelectData } from "../select/types.ts";
import { type StuckEntry, UNREAD_ONCE } from "./files.ts";

const MARKS_NAMED = 5;

function finalised({ id, before, state, stageNow }: ReconciledAttempt): string[] {
    const parsed = parseAttemptId(id);
    if (before !== "started" || state !== "completed" || parsed === null) {
        return [];
    }
    const { task, stage } = parsed;
    return [`${task.source}:${task.id} ${stage} → ${stageNow ?? "no single stage label"}`];
}

// Told once: only by the iteration that moves the attempt to retained.
function retained({ id, before, state, detail }: ReconciledAttempt): string[] {
    if (before === "retained" || state !== "retained") {
        return [];
    }
    return [`retained ${id}: ${detail ?? "no reason recorded"}`];
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
    return [`triage-me +${applied.length}: ${names.join(", ")}`];
}

export function iterationNotices(report: RunReport): string[] {
    const reconcile = report.steps.find((result) => result.step === "reconcile");
    const attempts = (reconcile?.data as ReconcileData | undefined)?.attempts ?? [];
    return [
        ...attempts.flatMap((attempt) => [...finalised(attempt), ...retained(attempt)]),
        ...newlyMarked(report),
    ];
}

// A changed exclusion or reason is a new entry, so it is told again.
const sameEntry = (a: StuckEntry, b: StuckEntry) =>
    a.task === b.task && a.exclusion === b.exclusion && a.detail === b.detail;

function entryOf({ source, id, reason, detail }: Excluded): StuckEntry {
    return { task: `${source}:${id}`, exclusion: reason, detail: detail ?? reason };
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
    const lines = told.slice(0, MARKS_NAMED).map(({ task, detail }) => `stuck ${task}: ${detail}`);
    if (told.length > MARKS_NAMED) {
        lines.push(`stuck +${told.length - MARKS_NAMED} more: see loop.log`);
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

export function stopNotice(reason: string): string {
    return `loop stopped: ${reason}`;
}
