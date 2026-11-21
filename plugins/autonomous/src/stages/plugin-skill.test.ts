import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ADVERSARIAL_REVIEW_SKILL, loadPluginSkill } from "./plugin-skill.ts";

const SOURCE_SKILL = new URL("../../skills/adversarial-review/SKILL.md", import.meta.url);

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
});
