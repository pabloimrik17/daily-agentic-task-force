// Ordered exclusions (work-selection, design D3): the first check that
// applies wins. Only tasks surviving the inexpensive checks need detail.

import type { AutonomousConfig } from "../config.ts";
import { detect } from "../label-contract/detect.ts";
import { LABEL_TRIAGE } from "../label-triage/question-id.ts";
import type { LabelTriageData } from "../label-triage/step.ts";
import type { TrackerResult } from "../label-triage/trackers/tracker.ts";
import { taskKey } from "../label-triage/write.ts";
import type { StepResult } from "../runner.ts";
import { isSupported, nextStage } from "./stage.ts";
import type { Candidate, Excluded, Exclusion, WorkTask } from "./types.ts";

interface CandidateDeps {
    config: AutonomousConfig;
    labelledThisRun: ReadonlySet<string>;
    detail: (task: WorkTask) => Promise<TrackerResult<WorkTask>>;
}

export function labelledThisRun(results: readonly StepResult[]): Set<string> {
    const keys = new Set<string>();
    for (const result of results) {
        if (result.step !== LABEL_TRIAGE) {
            continue;
        }
        const data = result.data as LabelTriageData;
        for (const record of data.records) {
            if (record.status === "applied") {
                keys.add(taskKey(record.source, record.taskId));
            }
        }
    }
    return keys;
}

function exclusionBeforeDetail(task: WorkTask, deps: CandidateDeps): Exclusion | null {
    const { groups } = detect(task, deps.config.sources[task.source]);
    if (groups.scope.status !== "present" || groups.entry.status !== "present") {
        return "classification";
    }
    if (task.labels.includes("taken")) {
        return "taken";
    }
    if (deps.labelledThisRun.has(taskKey(task.source, task.id))) {
        return "labelled-this-run";
    }
    if (!isSupported(nextStage(task.labels))) {
        return "unsupported-stage";
    }
    if (task.blockedBy !== null && task.blockedBy.length > 0) {
        return "blocked";
    }
    return null;
}

function candidate(task: WorkTask): Candidate {
    const autonomy = task.labels.includes("AFK")
        ? "AFK"
        : task.labels.includes("HITL")
          ? "HITL"
          : "grill-me";
    return {
        task,
        scope: task.labels.includes("work") ? "work" : "personal",
        autonomy,
        stage: nextStage(task.labels),
    };
}

export async function selectCandidates(
    tasks: readonly WorkTask[],
    deps: CandidateDeps,
): Promise<TrackerResult<{ candidates: Candidate[]; excluded: Excluded[] }>> {
    const candidates: Candidate[] = [];
    const excluded: Excluded[] = [];
    for (const task of tasks) {
        let reason = exclusionBeforeDetail(task, deps);
        if (reason === null) {
            const detailed = await deps.detail(task);
            if (!detailed.ok) {
                return detailed;
            }
            if (detailed.value.children !== null && detailed.value.children.length > 0) {
                reason = "split";
            } else {
                candidates.push(candidate(detailed.value));
                continue;
            }
        }
        excluded.push({ source: task.source, id: task.id, title: task.title, reason });
    }
    return { ok: true, value: { candidates, excluded } };
}
