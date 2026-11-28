// The skills the autonomous plugin ships, read from the plugin this module belongs to rather
// than from an installed copy, so a prompt carries the skill of the runner's own version (spec
// verification-stage, "The adversarial review is the running plugin's"; spec code-review-stage,
// "The review skills are the running plugin's").

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { stripFrontmatter } from "./skills.ts";
import type { ReadResult } from "./stage.ts";

export const ADVERSARIAL_REVIEW_SKILL = "adversarial-review";
export const REVIEW_TEAM_SKILL = "review-team";

// What a skill invocation would resolve, and a body pasted into a prompt does not.
const PLUGIN_ROOT_VARIABLE = "${CLAUDE_PLUGIN_ROOT}";

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export interface PluginSkillOptions {
    // Design D3 of add-code-review-stage: every ${CLAUDE_PLUGIN_ROOT} becomes <root>, so the
    // commands the body names run the runner's own code.
    resolveRoot?: boolean;
}

// Reads <root>/skills/<name>/SKILL.md and returns its body without frontmatter.
export async function loadPluginSkill(
    name: string,
    root: string = PLUGIN_ROOT,
    options: PluginSkillOptions = {},
): Promise<ReadResult<string>> {
    const file = join(root, "skills", name, "SKILL.md");
    try {
        const body = stripFrontmatter(await readFile(file, "utf8"));
        return {
            ok: true,
            value:
                options.resolveRoot === true ? body.replaceAll(PLUGIN_ROOT_VARIABLE, root) : body,
        };
    } catch (error) {
        return {
            ok: false,
            error: `cannot read the skill ${name} of the autonomous plugin at ${file}: ${messageOf(error)}`,
            unreadable: true,
        };
    }
}
