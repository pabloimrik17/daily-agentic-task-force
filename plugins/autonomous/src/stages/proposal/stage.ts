// Spec proposal-stage, "Proposal prerequisites" and "Proposal completion". The checks run in
// order and stop at the first failure, so each reason names the one thing missing; together they
// read everything the prompt needs.

import { stat } from "node:fs/promises";
import { join } from "node:path";

import type { TrackerTask } from "../../label-triage/trackers/tracker.ts";
import type { Result } from "../../result.ts";
import type { SessionTool } from "../../sessions/manager.ts";
import { proposalAutonomy, transitionRow } from "../../transition/mode.ts";
import { SKILLS_PLUGIN } from "../grill-me/prompt.ts";
import { loadSkills } from "../skills.ts";
import type { Stage, StageContext, StageEnv, StagePrerequisites } from "../stage.ts";
import { CONTEXT_KEY, HANDOFF_SKILL, PULL_REQUEST_KEY, proposalPrompt } from "./prompt.ts";

// No codex flags: the prerequisites never let a codex session start.
const AGENT_ARGS: Record<SessionTool, string[]> = {
    claude: ["--model", "opus", "--effort", "high"],
    codex: [],
};

type Check = (env: StageEnv) => Promise<Result<StageContext>>;

const NOTHING: Result<StageContext> = { ok: true, value: {} };

const failed = (error: string): Result<StageContext> => ({ ok: false, error });

const claudeOnly: Check = ({ tool }) =>
    Promise.resolve(
        tool === "claude"
            ? NOTHING
            : failed(`proposal runs only with claude; sessions.tool is ${tool}`),
    );

const oneAutonomy: Check = ({ task }) => {
    const found = proposalAutonomy(task, task.labels);
    return Promise.resolve(found.ok ? NOTHING : failed(found.error));
};

async function isDirectory(path: string): Promise<boolean> {
    try {
        return (await stat(path)).isDirectory();
    } catch {
        return false;
    }
}

// Only looked at: OpenSpec is initialised by a human, never by a run.
const openspecRoot: Check = async ({ repository }) => {
    const root = join(repository, "openspec");
    return (await isDirectory(root))
        ? NOTHING
        : failed(`the repository ${repository} has no OpenSpec root: ${root} is not a directory`);
};

const openspecCli: Check = async ({ readers }) => {
    const run = await readers.openspec(["--version"]);
    return run.ok ? NOTHING : failed(`\`openspec --version\` cannot run: ${run.error}`);
};

const handoffSkill: Check = async ({ home }) => {
    const skills = await loadSkills(home, SKILLS_PLUGIN, [HANDOFF_SKILL]);
    return skills.ok ? { ok: true, value: skills.value } : failed(skills.error);
};

const taskContext: Check = async ({ task, readers }) => {
    const read = await readers.context.read(task);
    return read.ok
        ? { ok: true, value: { [CONTEXT_KEY]: JSON.stringify(read.value) } }
        : failed(`cannot read the context of ${task.source} ${task.id}: ${read.error}`);
};

const openPullRequest: Check = async ({ branch, readers }) => {
    const found = await readers.pullRequests.find(branch);
    if (!found.ok) {
        return failed(`cannot look up the open pull request of ${branch}: ${found.error}`);
    }
    return found.value === null
        ? NOTHING
        : { ok: true, value: { [PULL_REQUEST_KEY]: JSON.stringify(found.value) } };
};

const CHECKS: readonly Check[] = [
    claudeOnly,
    oneAutonomy,
    openspecRoot,
    openspecCli,
    handoffSkill,
    taskContext,
    openPullRequest,
];

async function prerequisites(env: StageEnv): Promise<StagePrerequisites> {
    const context: Record<string, string> = {};
    for (const check of CHECKS) {
        const result = await check(env);
        if (!result.ok) {
            return { ok: false, reason: result.error };
        }
        Object.assign(context, result.value);
    }
    return { ok: true, context };
}

const { from, to } = transitionRow("proposal");

function completed({ closed, labels }: TrackerTask): boolean {
    return closed || (labels.includes(to) && !labels.includes(from));
}

export const proposalStage: Stage = {
    id: "proposal",
    emoji: "📝",
    prerequisites,
    agentArgs: (tool) => [...AGENT_ARGS[tool]],
    prompt: proposalPrompt,
    completed,
};
