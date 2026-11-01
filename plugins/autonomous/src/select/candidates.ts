// Ordered exclusions (work-selection, design D3): the first check that
// applies wins. Only tasks surviving the inexpensive checks need detail.

import type { AutonomousConfig } from "../config.ts";
import { detect, isComplete } from "../label-contract/detect.ts";
import { LABEL_TRIAGE } from "../label-triage/question-id.ts";
import type { LabelTriageData } from "../label-triage/step.ts";
import type { TrackerResult } from "../label-triage/trackers/tracker.ts";
import { taskKey } from "../label-triage/write.ts";
import type { StepResult } from "../runner.ts";
import type { StageId } from "../stages/stage.ts";
import { isSupported, nextStage } from "./stage.ts";
import type { Candidate, Excluded, Exclusion, WorkTask } from "./types.ts";

interface CandidateDeps {
    config: AutonomousConfig;
    labelledThisRun: ReadonlySet<string>;
    detail: (task: WorkTask) => Promise<TrackerResult<WorkTask>>;
    stage?: StageId; // supplied by `--stage`: the next stage's support is not checked
}

export function labelledThisRun(results: readonly StepResult[]): Set<string> {
    const keys = new Set<string>();
    for (const result of results) {
        if (result.step !== LABEL_TRIAGE) {
            continue;
        }
        const data = result.data as LabelTriageData;
        for (const record of data.records) {
            // A failed write may still have added some labels; only
            // proposed and asked records are known to have written nothing.
            if (record.status === "applied" || record.status === "failed") {
                keys.add(taskKey(record.source, record.taskId));
            }
        }
    }
    return keys;
}

// Classification (spec work-selection): every group present, or autonomy deferred
// while the stage is grill-me.
function isClassified(task: WorkTask, config: AutonomousConfig): boolean {
    const { groups } = detect(task, config.sources[task.source]);
    return Object.values(groups).every(isComplete);
}

// A task without a next stage cannot pass classification, but would count as unsupported.
function isUnsupportedStage(task: WorkTask, deps: CandidateDeps): boolean {
    const stage = nextStage(task.labels);
    return deps.stage === undefined && (stage === null || !isSupported(stage));
}

function exclusionBeforeDetail(task: WorkTask, deps: CandidateDeps): Exclusion | null {
    if (!isClassified(task, deps.config)) {
        return "classification";
    }
    if (task.labels.includes("taken")) {
        return "taken";
    }
    if (deps.labelledThisRun.has(taskKey(task.source, task.id))) {
        return "labelled-this-run";
    }
    if (isUnsupportedStage(task, deps)) {
        return "unsupported-stage";
    }
    if (task.blockedBy !== null && task.blockedBy.length > 0) {
        return "blocked";
    }
    return null;
}

// Null when the task has no next stage, which classification rules out.
function candidate(task: WorkTask): Candidate | null {
    const stage = nextStage(task.labels);
    if (stage === null) {
        return null;
    }
    const autonomy = task.labels.includes("AFK")
        ? "AFK"
        : task.labels.includes("HITL")
          ? "HITL"
          : null;
    return { task, scope: task.labels.includes("work") ? "work" : "personal", autonomy, stage };
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
                const found = candidate(detailed.value);
                if (found !== null) {
                    candidates.push(found);
                    continue;
                }
                reason = "unsupported-stage";
            }
        }
        excluded.push({ source: task.source, id: task.id, title: task.title, reason });
    }
    return { ok: true, value: { candidates, excluded } };
}
