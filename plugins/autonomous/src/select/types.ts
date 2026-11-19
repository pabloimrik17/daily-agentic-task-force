// Shared shapes of the select step (spec work-selection): the readers it uses
// beside the triage trackers (design D2), the exclusions (D3), the stages (D4),
// the comparison (D6) and the step's data (D9).

import type { AutonomousConfig, Scope, Source } from "../config.ts";
import type { AutonomyLabel, StageLabel } from "../label-contract/contract.ts";
import type { TrackerResult, TrackerTask } from "../label-triage/trackers/tracker.ts";

export interface TaskLink {
    id: string;
    url: string | null;
}

export interface WorkTask extends TrackerTask {
    priority: string | null; // the tracker's own priority label; null when it has none (GitHub)
    blocks: string[]; // ids this task blocks while it is open
    blockedBy: string[] | null; // open blockers; null: not evaluated (GitHub)
    children: string[] | null; // open children; null until detail reads them (GitHub, Linear)
    childCount: number | null; // children in all, closed included; null until detail reads them
    project: string | null; // Linear project name, read by detail; null elsewhere, when absent and before detail
    repository: string | null; // GitHub "owner/name", from the id; null elsewhere
    url?: string | null; // filled by detail; null when the tracker has none (Beads)
    parent?: TaskLink | null; // filled by detail; null when the task is not a subtask
}

export interface WorkReader {
    source: Source;
    list(): Promise<TrackerResult<WorkTask[]>>; // open tasks, as label-triage defines them per source
    detail(task: WorkTask): Promise<TrackerResult<WorkTask>>; // fills description and children when the listing lacks them
}

export type WorkReaderFactory = (config: AutonomousConfig) => WorkReader[]; // one per enabled source

export type StageName = StageLabel;

export type Exclusion =
    | "classification"
    | "taken"
    | "triage-me"
    | "labelled-this-run"
    | "unsupported-stage"
    | "blocked"
    | "split"
    | "no-free-slot";

type Autonomy = AutonomyLabel;

// A task every check permitted, with what the comparison needs about it.
export interface Candidate {
    task: WorkTask; // after detail(): description and children filled
    scope: Scope;
    autonomy: Autonomy | null; // null for a task in grill-me without one
    stage: StageName;
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

type SelectionResult = { ok: true; answer: SelectionAnswer } | { ok: false; error: string };

export type SelectionExec = (request: SelectionRequest) => Promise<SelectionResult>;

export interface SelectedUnit {
    source: Source;
    id: string;
    title: string;
    stage: StageName;
    autonomy: Autonomy | null;
    scope: Scope;
    explanation: string;
    exception: string | null; // non-null only when scope differs from the machine scope
}

type Summary = { source: Source; id: string; title: string; scope: Scope; stage: StageName };

export interface SelectData {
    machineScope: Scope | null;
    selected: SelectedUnit | null;
    candidates: Summary[]; // the candidates compared: those at the most advanced stage
    setAside: Summary[]; // candidates at a less advanced stage, left for a later run
    excluded: Excluded[];
    readyToClose: { source: Source; id: string; title: string }[]; // split parents whose children are all closed
    notEvaluated: string[]; // e.g. "github: dependencies"
    comparison: { model: string; effort: string } | null; // set only when the LLM was called
}
