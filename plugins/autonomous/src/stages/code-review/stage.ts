// Spec code-review-stage, "Code review prerequisites", "Optional tools are never prerequisites" and
// "Finding threads read at launch". The checks stop at the first failure, so each reason names the
// one thing missing.

import { execCommand } from "../../exec.ts";
import { guideAvailability } from "../../review-team/availability.ts";
import {
    type Check,
    changeCheck,
    checkAll,
    leftStage,
    openspecChecks,
    pluginSkillCheck,
} from "../openspec-stage.ts";
import { ADVERSARIAL_REVIEW_SKILL, REVIEW_TEAM_SKILL } from "../plugin-skill.ts";
import { opusHighArgs, type Stage } from "../stage.ts";
import {
    ADVERSARIAL_REVIEW_KEY,
    codeReviewPrompt,
    PLANNOTATOR_KEY,
    REVIEW_TEAM_KEY,
} from "./prompt.ts";
import { findingThreads } from "./threads.ts";

// As the review team's plan checks its reviewers.
const PLANNOTATOR_TIMEOUT_MS = 30_000;

// Never a failure: without Plannotator the stage has no walkthrough, and the prompt says so.
const plannotator: Check = async () => {
    const found = await guideAvailability({
        exec: (command) => execCommand(command, PLANNOTATOR_TIMEOUT_MS),
    });
    const reason = found.available ? "" : (found.reason ?? "not available");
    return { ok: true, value: { [PLANNOTATOR_KEY]: reason } };
};

// Design D3: both skills' commands name the plugin this run belongs to.
const CHECKS: readonly Check[] = [
    ...openspecChecks({ stage: "code-review", workflows: {}, pullRequest: "required" }),
    changeCheck,
    pluginSkillCheck(REVIEW_TEAM_SKILL, REVIEW_TEAM_KEY, { resolveRoot: true }),
    pluginSkillCheck(ADVERSARIAL_REVIEW_SKILL, ADVERSARIAL_REVIEW_KEY, { resolveRoot: true }),
    plannotator,
    findingThreads,
];

export const codeReviewStage: Stage = {
    id: "code-review",
    emoji: "🧐",
    prerequisites: checkAll(CHECKS),
    agentArgs: opusHighArgs,
    prompt: codeReviewPrompt,
    completed: leftStage("code-review"),
};
