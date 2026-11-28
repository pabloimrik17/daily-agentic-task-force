import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ADVERSARIAL_REVIEW_SKILL, loadPluginSkill, REVIEW_TEAM_SKILL } from "./plugin-skill.ts";

const SOURCE_SKILL = new URL("../../skills/adversarial-review/SKILL.md", import.meta.url);
const SOURCE_PLUGIN = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PLUGIN_ROOT_VARIABLE = ["$", "{CLAUDE_PLUGIN_ROOT}"].join("");

let root: string;

beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "plugin-skill-"));
});

afterEach(() => {
    rmSync(root, { recursive: true, force: true });
});

describe("loadPluginSkill", () => {
    // Spec verification-stage: the body comes from the plugin this module belongs to, the
    // source tree here, not from an installed copy.
    it("Run from a branch: reads the adversarial review from the running plugin's own directory", async () => {
        const text = readFileSync(SOURCE_SKILL, "utf8");
        const body = await loadPluginSkill(ADVERSARIAL_REVIEW_SKILL);
        expect(body).toEqual({ ok: true, value: text.slice(text.indexOf("\n---\n") + 5) });
    });

    it("returns the body without its frontmatter", async () => {
        const body = await loadPluginSkill(ADVERSARIAL_REVIEW_SKILL);
        expect(body.ok).toBe(true);
        expect(body.ok ? body.value : "").not.toMatch(/^---|^name:|^description:/m);
    });

    it("Skill file missing: fails with a reason naming its path", async () => {
        const path = join(root, "skills", ADVERSARIAL_REVIEW_SKILL, "SKILL.md");
        const body = await loadPluginSkill(ADVERSARIAL_REVIEW_SKILL, root);
        expect(body.ok).toBe(false);
        expect(body.ok ? "" : body.error).toContain(
            `cannot read the skill adversarial-review of the autonomous plugin at ${path}: `,
        );
    });

    // Spec code-review-stage, "The review skills are the running plugin's".
    it("Run from a branch: the review team body names the running plugin's directory in its commands", async () => {
        const body = await loadPluginSkill(REVIEW_TEAM_SKILL, undefined, { resolveRoot: true });

        expect(body.ok).toBe(true);
        const text = body.ok ? body.value : "";
        expect(text).not.toContain(PLUGIN_ROOT_VARIABLE);
        expect(text).toContain(`bun ${SOURCE_PLUGIN}/src/review-team/cli.ts plan`);
        expect(text).toContain(`bun ${SOURCE_PLUGIN}/src/review-team/cli.ts collect --dir <dir>`);
    });

    it("replaces every plugin root of a body with the directory it reads from, and none without the option", async () => {
        const file = join(root, "skills", "demo", "SKILL.md");
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(
            file,
            `---\nname: demo\n---\n\nRun \`bun ${PLUGIN_ROOT_VARIABLE}/a.ts\`, then \`bun ${PLUGIN_ROOT_VARIABLE}/b.ts\`.\n`,
        );

        expect(await loadPluginSkill("demo", root, { resolveRoot: true })).toEqual({
            ok: true,
            value: `\nRun \`bun ${root}/a.ts\`, then \`bun ${root}/b.ts\`.\n`,
        });
        expect(await loadPluginSkill("demo", root)).toEqual({
            ok: true,
            value: `\nRun \`bun ${PLUGIN_ROOT_VARIABLE}/a.ts\`, then \`bun ${PLUGIN_ROOT_VARIABLE}/b.ts\`.\n`,
        });
    });

    it("Review team skill missing: fails with a reason naming its path", async () => {
        const path = join(root, "skills", REVIEW_TEAM_SKILL, "SKILL.md");
        const body = await loadPluginSkill(REVIEW_TEAM_SKILL, root, { resolveRoot: true });
        expect(body.ok).toBe(false);
        expect(body.ok ? "" : body.error).toContain(
            `cannot read the skill review-team of the autonomous plugin at ${path}: `,
        );
    });
});
