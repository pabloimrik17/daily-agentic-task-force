// The skills the grill-me stage inlines into its prompt (design D2). A skill is the directory of
// that exact name holding a SKILL.md, whatever the plugin's version or category directory, so an
// update that moves skills does not break the lookup.

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import type { Result } from "../../result.ts";
import { array, object, optional, string } from "../../validate.ts";

export const SKILLS_PLUGIN = "mattpocock-skills";

const SKILL_FILE = "SKILL.md";

interface Installation {
    scope: string | undefined;
    installPath: string;
}

function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function isAbsent(error: unknown): boolean {
    const code = (error as NodeJS.ErrnoException).code;
    return code === "ENOENT" || code === "ENOTDIR";
}

function registryPath(home: string): string {
    return join(home, ".claude", "plugins", "installed_plugins.json");
}

function parseInstallation(value: unknown, path: string): Installation {
    const entry = object(value, path);
    return {
        scope: optional(entry, "scope", path, string),
        installPath: string(entry, "installPath", path),
    };
}

function parseInstallations(json: unknown): Installation[] {
    const plugins = object(object(json, "$").plugins, "$.plugins");
    return Object.entries(plugins)
        .filter(([key]) => key.startsWith(`${SKILLS_PLUGIN}@`))
        .flatMap(([key, entries]) => {
            const path = `$.plugins["${key}"]`;
            return array(entries, path).map((entry, index) =>
                parseInstallation(entry, `${path}[${index}]`),
            );
        });
}

async function readInstallations(file: string): Promise<Result<Installation[]>> {
    let text: string;
    try {
        text = await readFile(file, "utf8");
    } catch (error) {
        return { ok: false, error: `cannot read the plugin registry ${file}: ${messageOf(error)}` };
    }
    let json: unknown;
    try {
        json = JSON.parse(text);
    } catch (error) {
        return {
            ok: false,
            error: `the plugin registry ${file} is not valid JSON: ${messageOf(error)}`,
        };
    }
    try {
        return { ok: true, value: parseInstallations(json) };
    } catch (error) {
        return {
            ok: false,
            error: `the plugin registry ${file} is malformed: ${messageOf(error)}`,
        };
    }
}

async function findInstallPath(home: string): Promise<Result<string>> {
    const file = registryPath(home);
    const installations = await readInstallations(file);
    if (!installations.ok) {
        return installations;
    }
    const chosen =
        installations.value.find((entry) => entry.scope === "user") ?? installations.value[0];
    if (chosen === undefined) {
        return {
            ok: false,
            error: `the plugin ${SKILLS_PLUGIN} is not installed: ${file} has no "${SKILLS_PLUGIN}@..." entry`,
        };
    }
    return { ok: true, value: chosen.installPath };
}

async function readIfPresent(file: string): Promise<string | null> {
    try {
        return await readFile(file, "utf8");
    } catch (error) {
        if (isAbsent(error)) {
            return null;
        }
        throw error;
    }
}

async function categories(skillsDir: string): Promise<string[]> {
    try {
        return (await readdir(skillsDir)).sort();
    } catch (error) {
        if (isAbsent(error)) {
            return [];
        }
        throw error;
    }
}

async function findSkill(skillsDir: string, name: string): Promise<string | null> {
    const direct = await readIfPresent(join(skillsDir, name, SKILL_FILE));
    if (direct !== null) {
        return direct;
    }
    for (const category of await categories(skillsDir)) {
        const nested = await readIfPresent(join(skillsDir, category, name, SKILL_FILE));
        if (nested !== null) {
            return nested;
        }
    }
    return null;
}

// The leading `---` line through the next `---` line; text without that block is kept whole.
const FRONTMATTER = /^---[ \t]*\r?\n(?:[\s\S]*?\r?\n)?---[ \t]*(?:\r?\n|$)/;

function stripFrontmatter(text: string): string {
    return text.replace(FRONTMATTER, "");
}

async function loadSkill(skillsDir: string, name: string): Promise<Result<string>> {
    let text: string | null;
    try {
        text = await findSkill(skillsDir, name);
    } catch (error) {
        return {
            ok: false,
            error: `cannot read the skill ${name} under ${skillsDir}: ${messageOf(error)}`,
        };
    }
    if (text === null) {
        return { ok: false, error: `the skill ${name} is not found under ${skillsDir}` };
    }
    return { ok: true, value: stripFrontmatter(text) };
}

// Skill name → SKILL.md body without its frontmatter; the first failure, in `names` order, is the error.
export async function loadSkills(
    home: string,
    names: readonly string[],
): Promise<Result<Record<string, string>>> {
    const installPath = await findInstallPath(home);
    if (!installPath.ok) {
        return installPath;
    }
    const skillsDir = join(installPath.value, "skills");
    const loaded = await Promise.all(
        names.map(async (name) => ({ name, result: await loadSkill(skillsDir, name) })),
    );
    const skills: Record<string, string> = {};
    for (const { name, result } of loaded) {
        if (!result.ok) {
            return result;
        }
        skills[name] = result.value;
    }
    return { ok: true, value: skills };
}
