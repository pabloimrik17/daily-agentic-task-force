import { isAutonomyLabel } from "../../label-contract/contract.ts";
import type { TrackerTask } from "../../label-triage/trackers/tracker.ts";
import { transitionRow } from "../../transition/table.ts";
import { opusHighArgs, type Stage, type StageEnv, type StagePrerequisites } from "../stage.ts";
import { loadSkills } from "../skills.ts";
import { GRILL_ME_SKILLS, grillMePrompt, SKILLS_PLUGIN } from "./prompt.ts";

async function prerequisites({ tool, home }: StageEnv): Promise<StagePrerequisites> {
    if (tool !== "claude") {
        return { ok: false, reason: `grill-me runs only with claude; sessions.tool is ${tool}` };
    }
    const skills = await loadSkills(home, SKILLS_PLUGIN, GRILL_ME_SKILLS);
    return skills.ok ? { ok: true, context: skills.value } : { ok: false, reason: skills.error };
}

const { from, to } = transitionRow("grill-me");

function completed({ closed, labels }: TrackerTask): boolean {
    return (
        closed || (labels.includes(to) && !labels.includes(from) && labels.some(isAutonomyLabel))
    );
}

export const grillMeStage: Stage = {
    id: "grill-me",
    emoji: "🔥",
    prerequisites,
    agentArgs: opusHighArgs,
    prompt: grillMePrompt,
    completed,
};
