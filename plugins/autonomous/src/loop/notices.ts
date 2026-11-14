// What an iteration tells the agent that started the loop (spec autonomous-loop,
// "Notices"; design D7): finalised and newly retained attempts, read from the
// iteration's reconcile data. A launch or a session waiting for a person tells nothing.

import { parseAttemptId } from "../attempts/record.ts";
import type { ReconciledAttempt, ReconcileData } from "../attempts/reconcile.ts";
import type { RunReport } from "../report.ts";

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

export function iterationNotices(report: RunReport): string[] {
    const reconcile = report.steps.find((result) => result.step === "reconcile");
    const attempts = (reconcile?.data as ReconcileData | undefined)?.attempts ?? [];
    return attempts.flatMap((attempt) => [...finalised(attempt), ...retained(attempt)]);
}

export function stopNotice(reason: string): string {
    return `loop stopped: ${reason}`;
}
