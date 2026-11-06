// The grill-me stage (spec grill-me-stage; design D3, D6, D8): a claude session that
// refines the task with the human, persists the definition, and ends with the
// transition to `proposal`.

import { isAutonomyLabel } from "../../label-contract/contract.ts";
import type { TrackerTask } from "../../label-triage/trackers/tracker.ts";
import type { SessionTool } from "../../sessions/manager.ts";
import { FROM_STAGE, TO_STAGE } from "../../transition/mode.ts";
import type { Stage, StageEnv, StagePrerequisites } from "../stage.ts";
import { loadSkills } from "../skills.ts";
import { GRILL_ME_SKILLS, grillMePrompt, SKILLS_PLUGIN } from "./prompt.ts";

// DOT-119 replaces the fixed model. No codex flags: the prerequisites never let a codex session start.
const AGENT_ARGS: Record<SessionTool, string[]> = {
    claude: ["--model", "opus", "--effort", "high"],
    codex: [],
};

async function prerequisites({ tool, home }: StageEnv): Promise<StagePrerequisites> {
    if (tool !== "claude") {
        return { ok: false, reason: `grill-me runs only with claude; sessions.tool is ${tool}` };
    }
    const skills = await loadSkills(home, SKILLS_PLUGIN, GRILL_ME_SKILLS);
    return skills.ok ? { ok: true, context: skills.value } : { ok: false, reason: skills.error };
}

function completed({ closed, labels }: TrackerTask): boolean {
    return (
        closed ||
        (labels.includes(TO_STAGE) && !labels.includes(FROM_STAGE) && labels.some(isAutonomyLabel))
    );
}

export const grillMeStage: Stage = {
    id: "grill-me",
    emoji: "🔥",
    prerequisites,
    agentArgs: (tool) => [...AGENT_ARGS[tool]],
    prompt: grillMePrompt,
    completed,
};
