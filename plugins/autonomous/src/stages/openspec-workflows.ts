// The OpenSpec workflows a stage asks its agent to run, as the task's repository provides them:
// OpenSpec 1.x writes both the skill and the command, 2.0 only the skill, linked from
// `.agents/skills/`. The files decide, not `openspec --version`: the CLI on the path is the
// machine's, and the files are what the session sees.

import { stat } from "node:fs/promises";
import { join } from "node:path";

type OpenspecWorkflow = "propose" | "apply" | "update";

interface WorkflowForms {
    skill: string;
    command: string; // without its `/opsx:` prefix
}

const FORMS: Record<OpenspecWorkflow, WorkflowForms> = {
    propose: { skill: "openspec-propose", command: "propose" },
    apply: { skill: "openspec-apply-change", command: "apply" },
    update: { skill: "openspec-update-change", command: "update" },
};

const skillFile = (repository: string, { skill }: WorkflowForms) =>
    join(repository, ".claude", "skills", skill, "SKILL.md");

const commandFile = (repository: string, { command }: WorkflowForms) =>
    join(repository, ".claude", "commands", "opsx", `${command}.md`);

// `stat` follows links, so the directory OpenSpec 2.0 links counts as the skill.
async function isFile(path: string): Promise<boolean> {
    try {
        return (await stat(path)).isFile();
    } catch {
        return false;
    }
}

// What the prompt writes to have the agent run the workflow: the skill when the repository has
// it, since it exists in both major versions, else the command; null when it has neither.
export async function findWorkflow(
    repository: string,
    workflow: OpenspecWorkflow,
): Promise<string | null> {
    const forms = FORMS[workflow];
    if (await isFile(skillFile(repository, forms))) {
        return `/${forms.skill}`;
    }
    if (await isFile(commandFile(repository, forms))) {
        return `/opsx:${forms.command}`;
    }
    return null;
}

export function missingWorkflow(repository: string, workflow: OpenspecWorkflow): string {
    const forms = FORMS[workflow];
    return `the repository ${repository} provides neither the skill ${forms.skill} (${skillFile(repository, forms)}) nor the command /opsx:${forms.command} (${commandFile(repository, forms)}): update OpenSpec in that repository`;
}
