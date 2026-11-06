// Spec stage-sessions, "Stage contract". `prerequisites` runs in `launch` before anything is
// written, and what it reads reaches the synchronous `prompt` as `context`.

import type { AttemptRecord } from "../attempts/record.ts";
import type { TrackerTask } from "../label-triage/trackers/tracker.ts";
import type { WorkTask } from "../select/types.ts";
import type { SessionTool } from "../sessions/manager.ts";

// Every stage the system knows: the selectable ones (select's `StageName`) and `test`.
export const STAGE_IDS = ["test", "grill-me", "proposal"] as const;

export type StageId = (typeof STAGE_IDS)[number];

export function isStageId(value: string): value is StageId {
    return (STAGE_IDS as readonly string[]).includes(value);
}

export interface StageEnv {
    tool: SessionTool;
    home: string;
}

export type StageContext = Readonly<Record<string, string>>;

export type StagePrerequisites =
    | { ok: true; context: StageContext }
    | { ok: false; reason: string };

export interface StagePromptInput {
    attempt: AttemptRecord;
    task: WorkTask;
    resultPath: string; // absolute path of the result marker the agent writes
    context: StageContext;
}

export interface Stage {
    id: StageId;
    emoji: string;
    prerequisites(env: StageEnv): Promise<StagePrerequisites>;
    agentArgs(tool: SessionTool): string[]; // model and effort flags the stage wants
    prompt(input: StagePromptInput): string; // the whole prompt file
    completed(task: TrackerTask): boolean; // the tracker check; reconcile checks the marker
}
