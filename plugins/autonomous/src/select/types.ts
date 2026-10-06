// Shared shapes of the select step (spec work-selection): the readers it uses
// beside the triage trackers (design D2), the exclusions (D3), the stages (D4),
// the comparison (D6) and the step's data (D9).

import type { AutonomousConfig, Scope, Source } from "../config.ts";
import type { TrackerResult, TrackerTask } from "../label-triage/trackers/tracker.ts";

export interface WorkTask extends TrackerTask {
    priority: string | null; // the tracker's own priority label; null when it has none (GitHub)
    blocks: string[]; // ids this task blocks while it is open
    blockedBy: string[] | null; // open blockers; null: not evaluated (GitHub)
    children: string[] | null; // open children; null: not evaluated (GitHub) or not read yet (Linear before detail)
}

export interface WorkReader {
    source: Source;
    list(): Promise<TrackerResult<WorkTask[]>>; // open tasks, as label-triage defines them per source
    detail(task: WorkTask): Promise<TrackerResult<WorkTask>>; // fills description and children when the listing lacks them
}

export type WorkReaderFactory = (config: AutonomousConfig) => WorkReader[]; // one per enabled source

export type Stage = "grill-me" | "proposal";

export type Exclusion =
    | "classification"
    | "taken"
    | "labelled-this-run"
    | "unsupported-stage"
    | "blocked"
    | "split";

export type Autonomy = "AFK" | "HITL" | "grill-me";

// A task every check permitted, with what the comparison needs about it.
export interface Candidate {
    task: WorkTask; // after detail(): description and children filled
    scope: Scope;
    autonomy: Autonomy;
    stage: Stage;
}

export interface Excluded {
    source: Source;
    id: string;
    title: string;
    reason: Exclusion;
}

export interface SelectionRequest {
    model: string;
    effort: string;
    machineScope: Scope;
    candidates: Candidate[];
}

export interface SelectionAnswer {
    source: Source;
    id: string;
    explanation: string;
    exception: string | null;
}

export type SelectionResult = { ok: true; answer: SelectionAnswer } | { ok: false; error: string };

export type SelectionExec = (request: SelectionRequest) => Promise<SelectionResult>;

export interface SelectedUnit {
    source: Source;
    id: string;
    title: string;
    stage: Stage;
    autonomy: Autonomy;
    scope: Scope;
    explanation: string;
    exception: string | null; // non-null only when scope differs from the machine scope
}

export interface SelectData {
    machineScope: Scope | null;
    selected: SelectedUnit | null;
    candidates: { source: Source; id: string; title: string; scope: Scope; stage: Stage }[];
    excluded: Excluded[];
    notEvaluated: string[]; // e.g. "github: dependencies and children"
    comparison: { model: string; effort: string } | null; // set only when the LLM was called
}
