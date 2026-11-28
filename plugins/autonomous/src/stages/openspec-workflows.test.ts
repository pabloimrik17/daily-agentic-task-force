import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { findWorkflow, missingWorkflow } from "./openspec-workflows.ts";

let repository: string;

beforeEach(() => {
    repository = mkdtempSync(join(tmpdir(), "openspec-workflows-"));
});

afterEach(async () => {
    await rm(repository, { recursive: true, force: true });
});

function writeAt(path: string): void {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "---\nname: workflow\n---\n");
}

function withSkill(skill: string): void {
    writeAt(join(repository, ".claude", "skills", skill, "SKILL.md"));
}

// Laid out as OpenSpec 2.0 writes it: the skill under `.agents/skills/`, linked from `.claude/`.
function withLinkedSkill(skill: string): void {
    writeAt(join(repository, ".agents", "skills", skill, "SKILL.md"));
    mkdirSync(join(repository, ".claude", "skills"), { recursive: true });
    symlinkSync(
        join("..", "..", ".agents", "skills", skill),
        join(repository, ".claude", "skills", skill),
    );
}

function withCommand(command: string): void {
    writeAt(join(repository, ".claude", "commands", "opsx", `${command}.md`));
}

describe("findWorkflow", () => {
    it("skill only: names the skill", async () => {
        withSkill("openspec-propose");

        expect(await findWorkflow(repository, "propose")).toBe("/openspec-propose");
    });

    it("linked skill: follows the link and names the skill", async () => {
        withLinkedSkill("openspec-propose");

        expect(await findWorkflow(repository, "propose")).toBe("/openspec-propose");
    });

    it("command only: names the command", async () => {
        withCommand("propose");

        expect(await findWorkflow(repository, "propose")).toBe("/opsx:propose");
    });

    it("both: prefers the skill", async () => {
        withSkill("openspec-propose");
        withCommand("propose");

        expect(await findWorkflow(repository, "propose")).toBe("/openspec-propose");
    });

    it("neither: finds nothing", async () => {
        expect(await findWorkflow(repository, "propose")).toBeNull();
    });

    it("a dangling link to the skill is not the skill", async () => {
        mkdirSync(join(repository, ".claude", "skills"), { recursive: true });
        symlinkSync(
            join("..", "..", ".agents", "skills", "openspec-propose"),
            join(repository, ".claude", "skills", "openspec-propose"),
        );
        withCommand("propose");

        expect(await findWorkflow(repository, "propose")).toBe("/opsx:propose");
    });

    it("a skill directory without SKILL.md is not the skill", async () => {
        mkdirSync(join(repository, ".claude", "skills", "openspec-propose"), { recursive: true });

        expect(await findWorkflow(repository, "propose")).toBeNull();
    });

    it.each([
        ["apply", "openspec-apply-change", "apply", "/openspec-apply-change", "/opsx:apply"],
        ["update", "openspec-update-change", "update", "/openspec-update-change", "/opsx:update"],
    ] as const)(
        "maps %s to its own skill and command",
        async (workflow, skill, command, skillName, commandName) => {
            withCommand(command);
            expect(await findWorkflow(repository, workflow)).toBe(commandName);

            withSkill(skill);
            expect(await findWorkflow(repository, workflow)).toBe(skillName);
        },
    );

    it("verify: the skill names the skill", async () => {
        withSkill("openspec-verify-change");

        expect(await findWorkflow(repository, "verify")).toBe("/openspec-verify-change");
    });

    it("verify: the command names the command", async () => {
        withCommand("verify");

        expect(await findWorkflow(repository, "verify")).toBe("/opsx:verify");
    });

    it("verify with both: the skill wins", async () => {
        withSkill("openspec-verify-change");
        withCommand("verify");

        expect(await findWorkflow(repository, "verify")).toBe("/openspec-verify-change");
    });

    it("verify with neither: finds nothing", async () => {
        expect(await findWorkflow(repository, "verify")).toBeNull();
    });

    it("does not take one workflow's files for another's", async () => {
        withSkill("openspec-propose");
        withCommand("propose");

        expect(await findWorkflow(repository, "apply")).toBeNull();
    });
});

describe("missingWorkflow", () => {
    it("names the repository, both forms with their files, and the fix", () => {
        expect(missingWorkflow("/repo", "propose")).toBe(
            "the repository /repo provides neither the skill openspec-propose (/repo/.claude/skills/openspec-propose/SKILL.md) nor the command /opsx:propose (/repo/.claude/commands/opsx/propose.md): update OpenSpec in that repository",
        );
    });

    it("verify: names both of its forms", () => {
        expect(missingWorkflow("/repo", "verify")).toBe(
            "the repository /repo provides neither the skill openspec-verify-change (/repo/.claude/skills/openspec-verify-change/SKILL.md) nor the command /opsx:verify (/repo/.claude/commands/opsx/verify.md): update OpenSpec in that repository",
        );
    });
});
