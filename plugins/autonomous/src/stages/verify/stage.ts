// Spec verification-stage, "The verification stage", "Verification prerequisites", "The
// adversarial review is the running plugin's" and "Verification completion". The checks run in
// order and stop at the first failure, so each reason names the one thing missing; together they
// read everything the prompt needs.

import type { TrackerTask } from "../../label-triage/trackers/tracker.ts";
import type { SessionTool } from "../../sessions/manager.ts";
import { transitionRow } from "../../transition/mode.ts";
import { type Check, changeCheck, checkAll, openspecChecks } from "../openspec-stage.ts";
import { ADVERSARIAL_REVIEW_SKILL, loadPluginSkill } from "../plugin-skill.ts";
import type { Stage } from "../stage.ts";
import {
    ADVERSARIAL_REVIEW_KEY,
    UPDATE_WORKFLOW_KEY,
    VERIFY_WORKFLOW_KEY,
    verifyPrompt,
} from "./prompt.ts";

// No codex flags: the prerequisites never let a codex session start.
const AGENT_ARGS: Record<SessionTool, string[]> = {
    claude: ["--model", "opus", "--effort", "high"],
    codex: [],
};

// Design D3: read from the plugin this run belongs to, never from an installed copy.
const adversarialReview: Check = async () => {
    const body = await loadPluginSkill(ADVERSARIAL_REVIEW_SKILL);
    return body.ok ? { ok: true, value: { [ADVERSARIAL_REVIEW_KEY]: body.value } } : body;
};

// The pull request the implementation committed to is required: the change and its code live in it.
const CHECKS: readonly Check[] = [
    ...openspecChecks({
        stage: "verify",
        workflows: { [VERIFY_WORKFLOW_KEY]: "verify", [UPDATE_WORKFLOW_KEY]: "update" },
        pullRequest: "required",
    }),
    changeCheck,
    adversarialReview,
];

const { from, to } = transitionRow("verify");

function completed({ closed, labels }: TrackerTask): boolean {
    return closed || (labels.includes(to) && !labels.includes(from));
}

export const verifyStage: Stage = {
    id: "verify",
    emoji: "🔍",
    prerequisites: checkAll(CHECKS),
    agentArgs: (tool) => [...AGENT_ARGS[tool]],
    prompt: verifyPrompt,
    completed,
};
