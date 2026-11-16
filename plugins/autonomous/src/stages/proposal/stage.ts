// Spec proposal-stage, "Proposal prerequisites" and "Proposal completion". The checks run in
// order and stop at the first failure, so each reason names the one thing missing; together they
// read everything the prompt needs.

import type { TrackerTask } from "../../label-triage/trackers/tracker.ts";
import type { SessionTool } from "../../sessions/manager.ts";
import { transitionRow } from "../../transition/mode.ts";
import { type Check, checkAll, openspecChecks } from "../openspec-stage.ts";
import type { Stage } from "../stage.ts";
import { proposalPrompt, WORKFLOW_KEY } from "./prompt.ts";

// No codex flags: the prerequisites never let a codex session start.
const AGENT_ARGS: Record<SessionTool, string[]> = {
    claude: ["--model", "opus", "--effort", "high"],
    codex: [],
};

// No open pull request is fine: the first attempt opens it.
const CHECKS: readonly Check[] = openspecChecks({
    stage: "proposal",
    workflows: { [WORKFLOW_KEY]: "propose" },
    pullRequest: "optional",
});

const { from, to } = transitionRow("proposal");

function completed({ closed, labels }: TrackerTask): boolean {
    return closed || (labels.includes(to) && !labels.includes(from));
}

export const proposalStage: Stage = {
    id: "proposal",
    emoji: "📝",
    prerequisites: checkAll(CHECKS),
    agentArgs: (tool) => [...AGENT_ARGS[tool]],
    prompt: proposalPrompt,
    completed,
};
