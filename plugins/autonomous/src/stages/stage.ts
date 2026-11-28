// Spec stage-sessions, "Stage contract" and "Repository prerequisites of a stage". `prerequisites`
// runs in `launch` before anything is written, and what it reads reaches the synchronous `prompt`
// as `context`. `repositoryPrerequisites` reads only the repository, so `select` can check it
// for every candidate; `prerequisites` checks it too.

import type { AttemptRecord } from "../attempts/record.ts";
import type { ContextReader } from "../context/types.ts";
import type { Exec } from "../exec.ts";
import type { TrackerTask } from "../label-triage/trackers/tracker.ts";
import type { PullRequests } from "../pull-request/port.ts";
import type { WorkTask } from "../select/types.ts";
import type { SessionTool } from "../sessions/manager.ts";

// Every stage an attempt may name: `test` and the stage labels, except `ready-to-merge`,
// where no session ever runs.
export const STAGE_IDS = [
    "test",
    "grill-me",
    "proposal",
    "implement",
    "verify",
    "code-review",
    "qa",
    "external-review",
    "wrap-up",
] as const;

export type StageId = (typeof STAGE_IDS)[number];

export function isStageId(value: string): value is StageId {
    return (STAGE_IDS as readonly string[]).includes(value);
}

interface StageReaders {
    context: ContextReader; // of the task's source
    pullRequests: PullRequests; // bound to the repository
    openspec: Exec;
    git: Exec; // run with `-C <directory>`
}

export interface StageEnv {
    tool: SessionTool;
    home: string;
    task: WorkTask; // read again and detailed
    repository: string; // absolute path
    branch: string; // the workspace branch the attempt will use
    readers: StageReaders;
}

export type StageContext = Readonly<Record<string, string>>;

export type StagePrerequisites =
    | { ok: true; context: StageContext }
    | { ok: false; reason: string };

export type RepositoryPrerequisites = { ok: true } | { ok: false; reason: string };

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
    repositoryPrerequisites?(repository: string): Promise<RepositoryPrerequisites>; // absent: none
    agentArgs(tool: SessionTool): string[]; // model and effort flags the stage wants
    prompt(input: StagePromptInput): string; // the whole prompt file
    completed(task: TrackerTask): boolean; // the tracker check; reconcile checks the marker
}

// The model and effort of grill-me and the OpenSpec stages; DOT-119 replaces the fixed model. No
// codex flags: their prerequisites never let a codex session start.
const OPUS_HIGH: Record<SessionTool, readonly string[]> = {
    claude: ["--model", "opus", "--effort", "high"],
    codex: [],
};

export const opusHighArgs = (tool: SessionTool): string[] => [...OPUS_HIGH[tool]];
