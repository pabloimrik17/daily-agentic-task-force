// The context a stage's prompt carries about its task, one level deep (spec proposal-stage,
// "The run gathers the task's context"; design D4).

import type { AutonomousConfig, Source } from "../config.ts";
import type { Trackers, TrackerResult } from "../label-triage/trackers/tracker.ts";
import type { WorkTask } from "../select/types.ts";

export interface RelatedTask {
    id: string;
    title: string;
    state: string;
    url: string | null;
}

export interface ContextLink {
    title: string;
    url: string;
}

export interface TaskContext {
    comments: string[]; // bodies, oldest first
    parent: (RelatedTask & { description: string | null }) | null;
    children: RelatedTask[];
    blockedBy: RelatedTask[];
    blocks: RelatedTask[];
    related: RelatedTask[];
    duplicates: RelatedTask[];
    project: string | null; // Linear only
    attachments: ContextLink[]; // Linear only
    pullRequests: ContextLink[]; // GitHub only
    notes: string[]; // what was not read, e.g. "github: dependencies were not read"
}

export interface ContextReader {
    source: Source;
    read(task: WorkTask): Promise<TrackerResult<TaskContext>>; // an error names the command that failed
}

export type ContextReaders = Record<Source, ContextReader>;

export type ContextReaderFactory = (config: AutonomousConfig, trackers: Trackers) => ContextReaders;
