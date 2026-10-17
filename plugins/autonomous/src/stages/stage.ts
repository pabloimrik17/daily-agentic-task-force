// The stage contract (spec stage-sessions, "Stage contract"; design D6): what
// `reconcile` and `launch` need from a stage, so registering one takes no
// change to either step.

import type { AttemptRecord } from "../attempts/record.ts";
import type { TrackerTask } from "../label-triage/trackers/tracker.ts";
import type { WorkTask } from "../select/types.ts";
import type { SessionTool } from "../sessions/manager.ts";

export interface StagePromptInput {
    attempt: AttemptRecord;
    task: WorkTask;
    resultPath: string; // absolute path of the result marker the agent writes
}

export interface Stage {
    id: string;
    emoji: string;
    agentArgs(tool: SessionTool): string[]; // model and effort flags the stage wants
    prompt(input: StagePromptInput): string; // the whole prompt file
    completed(task: TrackerTask): boolean; // the tracker check; reconcile checks the marker
}
