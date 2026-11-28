// Spec external-review-stage, "The external review stage", "External review prerequisites" and
// "External review completion"; design D1. The code review's checks without the review team skill
// (its report is the review bots', not a team's), then the pull request's read.

import { findingThreads } from "../code-review/threads.ts";
import { ADVERSARIAL_REVIEW_KEY } from "../code-review/prompt.ts";
import {
    type Check,
    changeCheck,
    checkAll,
    leftStage,
    openspecChecks,
    pluginSkillCheck,
} from "../openspec-stage.ts";
import { ADVERSARIAL_REVIEW_SKILL } from "../plugin-skill.ts";
import { opusHighArgs, type Stage } from "../stage.ts";
import { externalReviewPrompt } from "./prompt.ts";
import { externalReviewCheck } from "./read.ts";

const CHECKS: readonly Check[] = [
    ...openspecChecks({ stage: "external-review", workflows: {}, pullRequest: "required" }),
    changeCheck,
    pluginSkillCheck(ADVERSARIAL_REVIEW_SKILL, ADVERSARIAL_REVIEW_KEY, { resolveRoot: true }),
    externalReviewCheck,
    findingThreads,
];

export const externalReviewStage: Stage = {
    id: "external-review",
    emoji: "🤖",
    prerequisites: checkAll(CHECKS),
    agentArgs: opusHighArgs,
    prompt: externalReviewPrompt,
    completed: leftStage("external-review"),
    // Design D10: a round that acted ends without a transition, so the task keeps its stage.
    roundEnded: ({ labels }) => labels.includes("external-review"),
};
