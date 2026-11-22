// Spec implementation-stage, "Implementation prerequisites", "The change to implement" and
// "Implementation completion". The checks run in order and stop at the first failure, so each
// reason names the one thing missing; together they read everything the prompt needs.

import type { TrackerTask } from "../../label-triage/trackers/tracker.ts";
import type { SessionTool } from "../../sessions/manager.ts";
import { transitionRow } from "../../transition/mode.ts";
import { type Check, changeCheck, checkAll, openspecChecks } from "../openspec-stage.ts";
import type { Stage } from "../stage.ts";
import { APPLY_WORKFLOW_KEY, implementPrompt, UPDATE_WORKFLOW_KEY } from "./prompt.ts";

// No codex flags: the prerequisites never let a codex session start.
const AGENT_ARGS: Record<SessionTool, string[]> = {
    claude: ["--model", "opus", "--effort", "high"],
    codex: [],
};

// The pull request proposal preparation opened is required: the change lives in it.
const CHECKS: readonly Check[] = [
    ...openspecChecks({
        stage: "implement",
        workflows: { [APPLY_WORKFLOW_KEY]: "apply", [UPDATE_WORKFLOW_KEY]: "update" },
        pullRequest: "required",
    }),
    changeCheck,
];

const { from, to } = transitionRow("implement");

function completed({ closed, labels }: TrackerTask): boolean {
    return closed || (labels.includes(to) && !labels.includes(from));
}

export const implementStage: Stage = {
    id: "implement",
    emoji: "🛠️",
    prerequisites: checkAll(CHECKS),
    agentArgs: (tool) => [...AGENT_ARGS[tool]],
    prompt: implementPrompt,
    completed,
};
