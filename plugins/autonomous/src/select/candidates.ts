// Ordered exclusions (work-selection, design D3): the first check that
// applies wins. Only tasks surviving the inexpensive checks need detail.

import { type TaskKey, taskKey } from "../attempts/record.ts";
import type { AutonomousConfig } from "../config.ts";
import { TAKEN_LABEL, TRIAGE_LABEL } from "../label-contract/contract.ts";
import { detect, isComplete } from "../label-contract/detect.ts";
import { LABEL_TRIAGE } from "../label-triage/question-id.ts";
import type { LabelTriageData } from "../label-triage/step.ts";
import type { TrackerResult } from "../label-triage/trackers/tracker.ts";
import type { StepResult } from "../runner.ts";
import type { StageId } from "../stages/stage.ts";
import { isSupported, nextStage } from "./stage.ts";
import type { Candidate, Excluded, Exclusion, SelectData, WorkTask } from "./types.ts";

interface CandidateDeps {
    config: AutonomousConfig;
    labelledThisRun: ReadonlySet<TaskKey>;
    detail: (task: WorkTask) => Promise<TrackerResult<WorkTask>>;
    stage?: StageId; // supplied by `--stage`: the next stage's support is not checked
    full?: SlotsFull; // set only in a loop iteration; absent, no task is excluded for a slot
}

export interface SlotsFull {
    grill: boolean;
    work: boolean;
}

interface Selection {
    candidates: Candidate[];
    excluded: Excluded[];
    readyToClose: SelectData["readyToClose"];
}

export function labelledThisRun(results: readonly StepResult[]): Set<TaskKey> {
    const keys = new Set<TaskKey>();
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
    if (task.labels.includes(TAKEN_LABEL)) {
        return "taken";
    }
    if (task.labels.includes(TRIAGE_LABEL)) {
        return "triage-me";
    }
    if (deps.labelledThisRun.has(taskKey(task.source, task.id))) {
        return "labelled-this-run";
    }
    if (isUnsupportedStage(task, deps)) {
        return "unsupported-stage";
    }
    if (task.blockedBy.length > 0) {
        return "blocked";
    }
    return null;
}

function hasOpenChild(task: WorkTask): boolean {
    return task.children !== null && task.children.length > 0;
}

// A parent in `proposal` is split once it ever had a child, closed or not; a grill of a task
// whose children are all closed was reopened on purpose.
function isSplit(task: WorkTask): boolean {
    return (
        hasOpenChild(task) || (nextStage(task.labels) === "proposal" && (task.childCount ?? 0) > 0)
    );
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

function excluding(task: WorkTask, reason: Exclusion): Excluded {
    return { source: task.source, id: task.id, title: task.title, reason };
}

// The slot kind of a stage (spec slot-limits): grill-me takes a grill slot, any other a work slot.
function hasNoFreeSlot({ stage }: Candidate, { full }: CandidateDeps): boolean {
    return full !== undefined && (stage === "grill-me" ? full.grill : full.work);
}

type Verdict = { found: Candidate } | { reason: Exclusion; readyToClose?: boolean };

function afterDetail(task: WorkTask, deps: CandidateDeps): Verdict {
    if (isSplit(task)) {
        return { reason: "split", readyToClose: !hasOpenChild(task) };
    }
    const found = candidate(task);
    if (found === null) {
        return { reason: "unsupported-stage" };
    }
    return hasNoFreeSlot(found, deps) ? { reason: "no-free-slot" } : { found };
}

async function judge(task: WorkTask, deps: CandidateDeps): Promise<TrackerResult<Verdict>> {
    const reason = exclusionBeforeDetail(task, deps);
    if (reason !== null) {
        return { ok: true, value: { reason } };
    }
    const detailed = await deps.detail(task);
    return detailed.ok ? { ok: true, value: afterDetail(detailed.value, deps) } : detailed;
}

function file(selection: Selection, task: WorkTask, verdict: Verdict): void {
    if ("found" in verdict) {
        selection.candidates.push(verdict.found);
        return;
    }
    if (verdict.readyToClose === true) {
        selection.readyToClose.push({ source: task.source, id: task.id, title: task.title });
    }
    selection.excluded.push(excluding(task, verdict.reason));
}

export async function selectCandidates(
    tasks: readonly WorkTask[],
    deps: CandidateDeps,
): Promise<TrackerResult<Selection>> {
    const selection: Selection = { candidates: [], excluded: [], readyToClose: [] };
    for (const task of tasks) {
        const verdict = await judge(task, deps);
        if (!verdict.ok) {
            return verdict;
        }
        file(selection, task, verdict.value);
    }
    return { ok: true, value: selection };
}
