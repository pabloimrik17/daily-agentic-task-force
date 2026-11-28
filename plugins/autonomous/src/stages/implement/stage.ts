// Spec implementation-stage, "Implementation prerequisites", "The change to implement" and
// "Implementation completion". The checks run in order and stop at the first failure, so each
// reason names the one thing missing; together they read everything the prompt needs.

import {
    type Check,
    changeCheck,
    checkAll,
    leftStage,
    openspecChecks,
    openspecRepository,
} from "../openspec-stage.ts";
import { opusHighArgs, type Stage } from "../stage.ts";
import { APPLY_WORKFLOW_KEY, implementPrompt, UPDATE_WORKFLOW_KEY } from "./prompt.ts";

// The pull request proposal preparation opened is required: the change lives in it.
const CHECKS: readonly Check[] = [
    ...openspecChecks({
        stage: "implement",
        workflows: { [APPLY_WORKFLOW_KEY]: "apply", [UPDATE_WORKFLOW_KEY]: "update" },
        pullRequest: "required",
    }),
    changeCheck,
];

export const implementStage: Stage = {
    id: "implement",
    emoji: "🛠️",
    prerequisites: checkAll(CHECKS),
    repositoryPrerequisites: openspecRepository,
    agentArgs: opusHighArgs,
    prompt: implementPrompt,
    completed: leftStage("implement"),
};
