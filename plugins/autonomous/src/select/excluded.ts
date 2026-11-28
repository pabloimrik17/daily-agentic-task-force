import type { HoldingAttempt } from "../attempts/open-attempt.ts";
import type { Scope } from "../config.ts";
import type { Excluded, Exclusion, WorkTask } from "./types.ts";

const STUCK: readonly Exclusion[] = ["repository", "repository-prerequisites", "prerequisites"];

// Spec work-selection, "Stuck tasks": a retained attempt waits for a person, a running one does not.
export function isStuck(reason: Exclusion, attempt: HoldingAttempt | null): boolean {
    return STUCK.includes(reason) || (reason === "open-attempt" && attempt?.state === "retained");
}

// The scope of a classified task, which carries exactly one scope label.
export function scopeOf(task: WorkTask): Scope {
    return task.labels.includes("work") ? "work" : "personal";
}

export interface ExclusionVerdict {
    reason: Exclusion;
    detail?: string;
    attempt?: HoldingAttempt;
}

export function excludedTask(
    task: WorkTask,
    { reason, detail, attempt }: ExclusionVerdict,
): Excluded {
    return {
        source: task.source,
        id: task.id,
        title: task.title,
        reason,
        detail: detail ?? null,
        stuck: isStuck(reason, attempt ?? null),
        scope: reason === "classification" ? null : scopeOf(task),
    };
}
