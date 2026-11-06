import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadSkills } from "./skills.ts";

const PLUGIN = "example-skills";
const REGISTRY_KEY = `${PLUGIN}@example`;

let home: string;

beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "skills-"));
});

afterEach(() => {
    rmSync(home, { recursive: true, force: true });
});

function registryFile(): string {
    return join(home, ".claude", "plugins", "installed_plugins.json");
}

function writeFileAt(file: string, content: string): void {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
}

function writeRegistry(plugins: Record<string, unknown>): void {
    writeFileAt(registryFile(), JSON.stringify({ version: 2, plugins }));
}

function installation(installPath: string, scope = "user"): Record<string, unknown> {
    return {
        scope,
        installPath,
        version: "1.3.2",
        installedAt: "2026-10-04T09:27:41.102Z",
        gitCommitSha: "a496f5513d4a4cf889bc48e189e579f4b0bdf6aa",
    };
}

function skillText(name: string, body: string): string {
    return `---\nname: ${name}\ndescription: ${name} skill\ndisable-model-invocation: true\n---\n${body}`;
}

function installPlugin(version: string, skills: Record<string, string>): string {
    const installPath = join(home, ".claude", "plugins", "cache", "example", PLUGIN, version);
    for (const [dir, content] of Object.entries(skills)) {
        writeFileAt(join(installPath, "skills", dir, "SKILL.md"), content);
    }
    return installPath;
}

function register(installPath: string): void {
    writeRegistry({ [REGISTRY_KEY]: [installation(installPath)] });
}

describe("loadSkills", () => {
    it("finds the skills laid out like 1.3.2 and passes over the decoy", async () => {
        register(
            installPlugin("1.3.2", {
                "engineering/grill-with-docs": skillText("grill-with-docs", "\nGrill body.\n"),
                "productivity/handoff": skillText("handoff", "\nHandoff body.\n"),
                "in-progress/claude-handoff": skillText("claude-handoff", "\nDecoy body.\n"),
            }),
        );

        const result = await loadSkills(home, PLUGIN, ["grill-with-docs", "handoff"]);

        expect(result).toEqual({
            ok: true,
            value: { "grill-with-docs": "\nGrill body.\n", handoff: "\nHandoff body.\n" },
        });
    });

    it("finds the same skills under another category and version directory", async () => {
        register(
            installPlugin("1.4.0", {
                "workflows/grill-with-docs": skillText("grill-with-docs", "Moved grill.\n"),
                "tools/handoff": skillText("handoff", "Moved handoff.\n"),
            }),
        );

        const result = await loadSkills(home, PLUGIN, ["grill-with-docs", "handoff"]);

        expect(result).toEqual({
            ok: true,
            value: { "grill-with-docs": "Moved grill.\n", handoff: "Moved handoff.\n" },
        });
    });

    it("finds a skill directly under skills/", async () => {
        register(installPlugin("2.0.0", { handoff: skillText("handoff", "Flat handoff.\n") }));

        expect(await loadSkills(home, PLUGIN, ["handoff"])).toEqual({
            ok: true,
            value: { handoff: "Flat handoff.\n" },
        });
    });

    it("matches the directory name exactly", async () => {
        const installPath = installPlugin("1.3.2", {
            "in-progress/claude-handoff": skillText("claude-handoff", "Decoy.\n"),
        });
        register(installPath);

        const result = await loadSkills(home, PLUGIN, ["handoff"]);

        expect(result).toEqual({
            ok: false,
            error: `the skill handoff is not found under ${join(installPath, "skills")}`,
        });
    });

    it("does not search deeper than two levels", async () => {
        const installPath = installPlugin("1.3.2", {
            "a/b/handoff": skillText("handoff", "Too deep.\n"),
        });
        register(installPath);

        const result = await loadSkills(home, PLUGIN, ["handoff"]);

        expect(result.ok).toBe(false);
    });

    it("ignores a directory without a SKILL.md", async () => {
        const installPath = installPlugin("1.3.2", {
            "productivity/handoff": skillText("handoff", "Real.\n"),
        });
        mkdirSync(join(installPath, "skills", "engineering", "handoff"), { recursive: true });
        register(installPath);

        expect(await loadSkills(home, PLUGIN, ["handoff"])).toEqual({
            ok: true,
            value: { handoff: "Real.\n" },
        });
    });

    it("returns an empty record for no names, once the plugin is found", async () => {
        register(installPlugin("1.3.2", {}));

        expect(await loadSkills(home, PLUGIN, [])).toEqual({ ok: true, value: {} });
    });

    it("tolerates unknown fields and other plugins in the registry", async () => {
        const installPath = installPlugin("1.3.2", {
            "productivity/handoff": skillText("handoff", "Body.\n"),
        });
        writeRegistry({
            "other@market": [{ scope: "user", installPath: join(home, "elsewhere"), extra: 1 }],
            "broken@market": "not a list",
            [REGISTRY_KEY]: [{ ...installation(installPath), futureField: { nested: true } }],
        });

        expect(await loadSkills(home, PLUGIN, ["handoff"])).toEqual({
            ok: true,
            value: { handoff: "Body.\n" },
        });
    });
});

describe("loadSkills — which installation", () => {
    it("prefers the user scope over another scope listed first", async () => {
        const project = installPlugin("1.3.1", {
            "productivity/handoff": skillText("handoff", "Project handoff.\n"),
        });
        const user = installPlugin("1.3.2", {
            "productivity/handoff": skillText("handoff", "User handoff.\n"),
        });
        writeRegistry({
            [REGISTRY_KEY]: [installation(project, "project"), installation(user, "user")],
        });

        expect(await loadSkills(home, PLUGIN, ["handoff"])).toEqual({
            ok: true,
            value: { handoff: "User handoff.\n" },
        });
    });

    it("takes the first entry when none has the user scope", async () => {
        const first = installPlugin("1.3.1", {
            "productivity/handoff": skillText("handoff", "First handoff.\n"),
        });
        const second = installPlugin("1.3.2", {
            "productivity/handoff": skillText("handoff", "Second handoff.\n"),
        });
        writeRegistry({
            [REGISTRY_KEY]: [installation(first, "project"), installation(second, "local")],
        });

        expect(await loadSkills(home, PLUGIN, ["handoff"])).toEqual({
            ok: true,
            value: { handoff: "First handoff.\n" },
        });
    });

    it("looks across every marketplace key of the plugin for the user scope", async () => {
        const project = installPlugin("1.3.1", {
            "productivity/handoff": skillText("handoff", "Project handoff.\n"),
        });
        const user = installPlugin("1.3.2", {
            "productivity/handoff": skillText("handoff", "User handoff.\n"),
        });
        writeRegistry({
            [`${PLUGIN}@first`]: [installation(project, "project")],
            [`${PLUGIN}@second`]: [installation(user, "user")],
        });

        expect(await loadSkills(home, PLUGIN, ["handoff"])).toEqual({
            ok: true,
            value: { handoff: "User handoff.\n" },
        });
    });
});

describe("loadSkills — frontmatter", () => {
    it("strips the frontmatter and keeps the body intact, `---` lines included", async () => {
        const body = "\n# Title\n\n---\n\nText between rules.\n\n---\nlast: line\n";
        register(installPlugin("1.3.2", { "productivity/handoff": skillText("handoff", body) }));

        expect(await loadSkills(home, PLUGIN, ["handoff"])).toEqual({
            ok: true,
            value: { handoff: body },
        });
    });

    it("keeps a file without frontmatter whole", async () => {
        const text = "# No frontmatter\n\n---\n\nStill a body.\n";
        register(installPlugin("1.3.2", { "productivity/handoff": text }));

        expect(await loadSkills(home, PLUGIN, ["handoff"])).toEqual({
            ok: true,
            value: { handoff: text },
        });
    });

    it("strips an empty frontmatter block", async () => {
        register(installPlugin("1.3.2", { "productivity/handoff": "---\n---\nBody.\n" }));

        expect(await loadSkills(home, PLUGIN, ["handoff"])).toEqual({
            ok: true,
            value: { handoff: "Body.\n" },
        });
    });

    it("strips frontmatter written with CRLF line endings", async () => {
        register(
            installPlugin("1.3.2", {
                "productivity/handoff": "---\r\nname: handoff\r\n---\r\nBody.\r\n",
            }),
        );

        expect(await loadSkills(home, PLUGIN, ["handoff"])).toEqual({
            ok: true,
            value: { handoff: "Body.\r\n" },
        });
    });

    it("keeps a file whose frontmatter never closes", async () => {
        const text = "---\nname: handoff\nBody without a closing rule.\n";
        register(installPlugin("1.3.2", { "productivity/handoff": text }));

        expect(await loadSkills(home, PLUGIN, ["handoff"])).toEqual({
            ok: true,
            value: { handoff: text },
        });
    });
});

describe("loadSkills — reasons", () => {
    it("names the registry file when it is missing", async () => {
        const result = await loadSkills(home, PLUGIN, ["handoff"]);

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error).toContain(registryFile());
            expect(result.error).toContain("cannot read the plugin registry");
        }
    });

    it("names the registry file when it is not JSON", async () => {
        writeFileAt(registryFile(), "{not json");

        const result = await loadSkills(home, PLUGIN, ["handoff"]);

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error).toContain(registryFile());
            expect(result.error).toContain("is not valid JSON");
        }
    });

    it("names the registry file and the field when the shape is wrong", async () => {
        writeFileAt(registryFile(), JSON.stringify({ version: 2 }));

        const result = await loadSkills(home, PLUGIN, ["handoff"]);

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error).toContain(registryFile());
            expect(result.error).toContain("is malformed");
            expect(result.error).toContain("$.plugins must be an object");
        }
    });

    it("names the field of an entry without an install path", async () => {
        writeRegistry({ [REGISTRY_KEY]: [{ scope: "user" }] });

        const result = await loadSkills(home, PLUGIN, ["handoff"]);

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error).toContain(registryFile());
            expect(result.error).toContain("installPath must be a string");
        }
    });

    it("names the plugin and the registry when the plugin has no entry", async () => {
        writeRegistry({ "other@market": [installation(join(home, "other"))] });

        const result = await loadSkills(home, PLUGIN, ["handoff"]);

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error).toContain(PLUGIN);
            expect(result.error).toContain(registryFile());
            expect(result.error).toContain("not installed");
        }
    });

    it("names the plugin when its entry list is empty", async () => {
        writeRegistry({ [REGISTRY_KEY]: [] });

        const result = await loadSkills(home, PLUGIN, ["handoff"]);

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error).toContain("not installed");
        }
    });

    it("names the missing skill and the path searched, not the one that is there", async () => {
        const installPath = installPlugin("1.3.2", {
            "engineering/grill-with-docs": skillText("grill-with-docs", "Grill.\n"),
        });
        register(installPath);

        const result = await loadSkills(home, PLUGIN, ["grill-with-docs", "handoff"]);

        expect(result).toEqual({
            ok: false,
            error: `the skill handoff is not found under ${join(installPath, "skills")}`,
        });
    });

    it("names the install path searched when the plugin directory is gone", async () => {
        const installPath = join(home, "gone");
        register(installPath);

        const result = await loadSkills(home, PLUGIN, ["handoff"]);

        expect(result).toEqual({
            ok: false,
            error: `the skill handoff is not found under ${join(installPath, "skills")}`,
        });
    });

    it("reports the first missing skill in the order asked", async () => {
        register(installPlugin("1.3.2", {}));

        const result = await loadSkills(home, PLUGIN, ["handoff", "grill-with-docs"]);

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error).toContain("handoff");
            expect(result.error).not.toContain("grill-with-docs");
        }
    });
});
