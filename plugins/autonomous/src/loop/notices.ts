// What an iteration tells the agent that started the loop (spec autonomous-loop,
// "Notices"; design D7, D9): finalised and newly retained attempts, read from the
// iteration's reconcile data, and the tasks the iteration newly marked `triage-me`, read
// from its label-triage data. A launch or a session waiting for a person tells nothing.

import { parseAttemptId } from "../attempts/record.ts";
import type { ReconciledAttempt, ReconcileData } from "../attempts/reconcile.ts";
import { LABEL_TRIAGE } from "../label-triage/question-id.ts";
import type { LabelTriageData } from "../label-triage/step.ts";
import type { RunReport } from "../report.ts";

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

export function stopNotice(reason: string): string {
    return `loop stopped: ${reason}`;
}
