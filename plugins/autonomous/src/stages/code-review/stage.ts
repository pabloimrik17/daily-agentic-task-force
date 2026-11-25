// Spec code-review-stage, "Code review prerequisites", "Optional tools are never prerequisites" and
// "Finding threads read at launch". The checks stop at the first failure, so each reason names the
// one thing missing.

import { execCommand } from "../../exec.ts";
import type { TrackerTask } from "../../label-triage/trackers/tracker.ts";
import { guideAvailability } from "../../review-team/availability.ts";
import type { SessionTool } from "../../sessions/manager.ts";
import { transitionRow } from "../../transition/mode.ts";
import {
    type Check,
    changeCheck,
    checkAll,
    openspecChecks,
    pluginSkillCheck,
} from "../openspec-stage.ts";
import { ADVERSARIAL_REVIEW_SKILL, REVIEW_TEAM_SKILL } from "../plugin-skill.ts";
import type { Stage } from "../stage.ts";
import {
    ADVERSARIAL_REVIEW_KEY,
    codeReviewPrompt,
    PLANNOTATOR_KEY,
    REVIEW_TEAM_KEY,
} from "./prompt.ts";
import { findingThreads } from "./threads.ts";

// No codex flags: the prerequisites never let a codex session start.
const AGENT_ARGS: Record<SessionTool, string[]> = {
    claude: ["--model", "opus", "--effort", "high"],
    codex: [],
};

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

const { from, to } = transitionRow("code-review");

function completed({ closed, labels }: TrackerTask): boolean {
    return closed || (labels.includes(to) && !labels.includes(from));
}

export const codeReviewStage: Stage = {
    id: "code-review",
    emoji: "🧐",
    prerequisites: checkAll(CHECKS),
    agentArgs: (tool) => [...AGENT_ARGS[tool]],
    prompt: codeReviewPrompt,
    completed,
};
