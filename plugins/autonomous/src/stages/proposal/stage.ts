// Spec proposal-stage, "Proposal prerequisites" and "Proposal completion". The checks run in
// order and stop at the first failure, so each reason names the one thing missing; together they
// read everything the prompt needs.

import { type Check, checkAll, leftStage, openspecChecks } from "../openspec-stage.ts";
import { opusHighArgs, type Stage } from "../stage.ts";
import { proposalPrompt, WORKFLOW_KEY } from "./prompt.ts";

// No open pull request is fine: the first attempt opens it.
const CHECKS: readonly Check[] = openspecChecks({
    stage: "proposal",
    workflows: { [WORKFLOW_KEY]: "propose" },
    pullRequest: "optional",
});

export const proposalStage: Stage = {
    id: "proposal",
    emoji: "📝",
    prerequisites: checkAll(CHECKS),
    agentArgs: opusHighArgs,
    prompt: proposalPrompt,
    completed: leftStage("proposal"),
};
