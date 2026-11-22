// The skills the autonomous plugin ships, read from the plugin this module belongs to rather
// than from an installed copy, so a prompt carries the skill of the runner's own version (spec
// verification-stage, "The adversarial review is the running plugin's").

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Result } from "../result.ts";
import { stripFrontmatter } from "./skills.ts";

export const ADVERSARIAL_REVIEW_SKILL = "adversarial-review";

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

// Reads <root>/skills/<name>/SKILL.md and returns its body without frontmatter.
export async function loadPluginSkill(
    name: string,
    root: string = PLUGIN_ROOT,
): Promise<Result<string>> {
    const file = join(root, "skills", name, "SKILL.md");
    try {
        return { ok: true, value: stripFrontmatter(await readFile(file, "utf8")) };
    } catch (error) {
        return {
            ok: false,
            error: `cannot read the skill ${name} of the autonomous plugin at ${file}: ${messageOf(error)}`,
        };
    }
}
