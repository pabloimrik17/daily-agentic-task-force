import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
    CONFIG_SCHEMA,
    DEFAULTS_PATH,
    EXAMPLE_PATH,
    loadConfig,
    parseConfig,
    resolveConfigPath,
} from "./config.ts";

const valid = () => ({
    schema: CONFIG_SCHEMA,
    sources: {
        linear: { enabled: true, scope: "personal", aliases: { "grill-me": ["Grill Me"] } },
        beads: {
            enabled: true,
            directory: "/path/to/repo",
            aliases: { work: ["nazaries"], personal: ["project:personal"], HITL: ["human"] },
        },
        github: { enabled: true, repos: ["owner/repo"], scope: "personal" },
    },
    judgement: { model: "claude-sonnet-5", effort: "medium", threshold: 0.95, cap: 25, batch: 20 },
    selection: { model: "sonnet", effort: "high" },
    sessions: { tool: "claude", profile: null, binary: null },
    workspace: { root: "/home/me/WebstormProjects" },
    naming: { model: "haiku", effort: "low" },
});

const withoutOptional = (): Record<string, unknown> => {
    const input: Record<string, unknown> = valid();
    delete input.sessions;
    delete input.workspace;
    delete input.naming;
    return input;
};

const ALL_DEFAULTED = [
    "sessions.tool",
    "sessions.profile",
    "sessions.binary",
    "workspace.root",
    "naming.model",
    "naming.effort",
];
const MISMATCH = "configuration does not match autonomous.config.v1: ";

describe("resolveConfigPath", () => {
    it("uses AUTONOMOUS_CONFIG when set", () => {
        expect(
            resolveConfigPath({ AUTONOMOUS_CONFIG: "/custom/config.json", HOME: "/home/x" }),
        ).toBe("/custom/config.json");
    });

    it("ignores an empty AUTONOMOUS_CONFIG", () => {
        expect(resolveConfigPath({ AUTONOMOUS_CONFIG: "", HOME: "/home/x" })).toBe(
            join("/home/x", ".config", "autonomous", "config.json"),
        );
    });

    it("defaults to HOME/.config/autonomous/config.json", () => {
        expect(resolveConfigPath({ HOME: "/home/x" })).toBe(
            join("/home/x", ".config", "autonomous", "config.json"),
        );
    });

    it("falls back to os.homedir() when HOME is missing", () => {
        expect(resolveConfigPath({})).toBe(join(homedir(), ".config", "autonomous", "config.json"));
    });
});

describe("parseConfig", () => {
    it("accepts a valid document", () => {
        const result = parseConfig(valid());
        expect(result.ok).toBe(true);
    });

    it("rejects a missing required field", () => {
        const input = valid();
        delete (input.sources.beads as { directory?: string }).directory;
        const result = parseConfig(input);
        expect(result).toEqual({
            ok: false,
            error: "configuration does not match autonomous.config.v1: $.sources.beads.directory must be a string",
        });
    });

    it("rejects an empty Beads directory", () => {
        const input = valid();
        input.sources.beads.directory = "";
        const result = parseConfig(input);
        expect(result).toEqual({
            ok: false,
            error: "configuration does not match autonomous.config.v1: $.sources.beads.directory must not be empty",
        });
    });

    it.each(["owner", "owner/", "/repo", "owner/repo/extra", "owner /repo", ""])(
        "rejects the GitHub repository %j, which is not owner/name",
        (repo) => {
            const input = valid();
            input.sources.github.repos = ["owner/repo", repo];
            const result = parseConfig(input);
            expect(result).toEqual({
                ok: false,
                error: 'configuration does not match autonomous.config.v1: $.sources.github.repos[1] must be "owner/name"',
            });
        },
    );

    it("rejects a mistyped field", () => {
        const input = { ...valid(), judgement: { ...valid().judgement, threshold: "high" } };
        const result = parseConfig(input);
        expect(result).toEqual({
            ok: false,
            error: "configuration does not match autonomous.config.v1: $.judgement.threshold must be a finite number",
        });
    });

    it("rejects an unknown field at the root", () => {
        const result = parseConfig({ ...valid(), extra: true });
        expect(result).toEqual({
            ok: false,
            error: "configuration does not match autonomous.config.v1: $.extra is not a recognised field",
        });
    });

    it("rejects an unknown field inside a source", () => {
        const input = valid();
        (input.sources.github as Record<string, unknown>).extra = true;
        const result = parseConfig(input);
        expect(result).toEqual({
            ok: false,
            error: "configuration does not match autonomous.config.v1: $.sources.github.extra is not a recognised field",
        });
    });

    it("rejects an alias for taken with the alias's path", () => {
        const input = valid();
        (input.sources.beads.aliases as Record<string, string[]>).taken = ["in-progress"];
        const result = parseConfig(input);
        expect(result).toEqual({
            ok: false,
            error: "configuration does not match autonomous.config.v1: $.sources.beads.aliases.taken is not a recognised field",
        });
    });

    it("returns the selection settings", () => {
        const result = parseConfig(valid());
        expect(result.ok && result.value.selection).toEqual({ model: "sonnet", effort: "high" });
    });

    it("rejects a config without selection with the path selection", () => {
        const input: Record<string, unknown> = valid();
        delete input.selection;
        const result = parseConfig(input);
        expect(result).toEqual({
            ok: false,
            error: "configuration does not match autonomous.config.v1: $.selection must be an object",
        });
    });

    it("rejects an unknown field inside selection", () => {
        const input = { ...valid(), selection: { ...valid().selection, threshold: 0.9 } };
        const result = parseConfig(input);
        expect(result).toEqual({
            ok: false,
            error: "configuration does not match autonomous.config.v1: $.selection.threshold is not a recognised field",
        });
    });

    it("rejects a selection effort outside the known levels", () => {
        const input = { ...valid(), selection: { ...valid().selection, effort: "extreme" } };
        const result = parseConfig(input);
        expect(result).toEqual({
            ok: false,
            error: "configuration does not match autonomous.config.v1: $.selection.effort must be one of low, medium, high, xhigh, max",
        });
    });

    it("rejects an unknown field inside judgement", () => {
        const input = { ...valid(), judgement: { ...valid().judgement, extra: true } };
        const result = parseConfig(input);
        expect(result).toEqual({
            ok: false,
            error: "configuration does not match autonomous.config.v1: $.judgement.extra is not a recognised field",
        });
    });
});

describe("optional blocks", () => {
    it("fills every key of a file without the blocks and lists all six paths", () => {
        const result = parseConfig(withoutOptional(), undefined, "/home/me");
        expect(result.ok && result.defaulted).toEqual(ALL_DEFAULTED);
        expect(result.ok && result.value.sessions).toEqual({
            tool: "claude",
            profile: null,
            binary: null,
        });
        expect(result.ok && result.value.workspace).toEqual({
            root: join("/home/me", "WebstormProjects"),
        });
        expect(result.ok && result.value.naming).toEqual({ model: "haiku", effort: "low" });
    });

    it("keeps the other defaults when sessions.tool is set alone", () => {
        const input = { ...withoutOptional(), sessions: { tool: "codex" } };
        const result = parseConfig(input, undefined, "/home/me");
        expect(result.ok && result.value.sessions).toEqual({
            tool: "codex",
            profile: null,
            binary: null,
        });
        expect(result.ok && result.defaulted).toEqual(ALL_DEFAULTED.slice(1));
    });

    it("takes a block's own values for profile and binary", () => {
        const sessions = { tool: "claude", profile: "work", binary: "/usr/local/bin/claude-w" };
        const result = parseConfig({ ...valid(), sessions });
        expect(result.ok && result.value.sessions).toEqual(sessions);
    });

    it("rejects a session tool the manager does not run, with its path", () => {
        const input = { ...valid(), sessions: { tool: "opencode" } };
        expect(parseConfig(input)).toEqual({
            ok: false,
            error: `${MISMATCH}$.sessions.tool must be "claude" or "codex"`,
        });
    });

    it("rejects a naming effort outside the known levels, with its path", () => {
        const input = { ...valid(), naming: { effort: "fast" } };
        expect(parseConfig(input)).toEqual({
            ok: false,
            error: `${MISMATCH}$.naming.effort must be one of low, medium, high, xhigh, max`,
        });
    });

    it.each([
        ["sessions", { extra: true }, "$.sessions.extra"],
        ["workspace", { root: "/w", extra: true }, "$.workspace.extra"],
        ["naming", { extra: true }, "$.naming.extra"],
    ])("rejects an unknown key inside %s with its path", (block, value, path) => {
        const result = parseConfig({ ...withoutOptional(), [block]: value });
        expect(result).toEqual({
            ok: false,
            error: `${MISMATCH}${path} is not a recognised field`,
        });
    });

    it.each([
        ["sessions", "$.sessions"],
        ["workspace", "$.workspace"],
        ["naming", "$.naming"],
    ])("rejects a %s block that is not an object", (block, path) => {
        const result = parseConfig({ ...withoutOptional(), [block]: "claude" });
        expect(result).toEqual({ ok: false, error: `${MISMATCH}${path} must be an object` });
    });

    it.each([
        [{ profile: 3 }, "$.sessions.profile must be a string or null"],
        [{ profile: "" }, "$.sessions.profile must not be empty"],
        [{ binary: false }, "$.sessions.binary must be a string or null"],
        [{ binary: "" }, "$.sessions.binary must not be empty"],
    ])("rejects the sessions keys %j", (sessions, message) => {
        const result = parseConfig({ ...valid(), sessions: { tool: "claude", ...sessions } });
        expect(result).toEqual({ ok: false, error: `${MISMATCH}${message}` });
    });

    it("rejects an empty workspace root", () => {
        const result = parseConfig({ ...valid(), workspace: { root: "" } });
        expect(result).toEqual({
            ok: false,
            error: `${MISMATCH}$.workspace.root must not be empty`,
        });
    });

    it.each([
        ["~", "/home/me"],
        ["~/code", join("/home/me", "code")],
        ["/abs/code", "/abs/code"],
        ["~other/code", "~other/code"],
    ])("expands the workspace root %s with HOME", (root, expected) => {
        const result = parseConfig({ ...valid(), workspace: { root } }, undefined, "/home/me");
        expect(result.ok && result.value.workspace.root).toBe(expected);
    });

    it("takes the shipped defaults from the defaults file", () => {
        const shipped = JSON.parse(readFileSync(DEFAULTS_PATH, "utf8")) as unknown;
        expect(shipped).toEqual({
            sessions: { tool: "claude", profile: null, binary: null },
            workspace: { root: "~/WebstormProjects" },
            naming: { model: "haiku", effort: "low" },
        });
    });

    it("uses the defaults it is given", () => {
        const defaults = {
            sessions: { tool: "codex", profile: "p", binary: "b" },
            workspace: { root: "/srv" },
            naming: { model: "m", effort: "max" },
        };
        const result = parseConfig(withoutOptional(), defaults);
        expect(result.ok && result.value.sessions).toEqual({
            tool: "codex",
            profile: "p",
            binary: "b",
        });
        expect(result.ok && result.value.workspace.root).toBe("/srv");
    });
});

describe("loadConfig", () => {
    it("reports a missing file naming the path and the example", () => {
        const env = { AUTONOMOUS_CONFIG: "/does/not/exist.json" };
        const readFile = () => {
            throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
        };
        const result = loadConfig(env, readFile);
        expect(result.ok).toBe(false);
        expect(!result.ok && result.error).toContain("/does/not/exist.json");
        expect(!result.ok && result.error).toContain(EXAMPLE_PATH);
    });

    it("loads a valid file", () => {
        const env = { AUTONOMOUS_CONFIG: "/fake/config.json" };
        const readFile = () => JSON.stringify(valid());
        const result = loadConfig(env, readFile);
        expect(result.ok).toBe(true);
        expect(result.ok && result.config.schema).toBe(CONFIG_SCHEMA);
    });

    it("lists the defaulted keys and expands ~ with the HOME of the env", () => {
        const env = { AUTONOMOUS_CONFIG: "/fake/config.json", HOME: "/home/me" };
        const result = loadConfig(env, () => JSON.stringify(withoutOptional()));
        expect(result.ok && result.defaulted).toEqual(ALL_DEFAULTED);
        expect(result.ok && result.config.workspace.root).toBe(
            join("/home/me", "WebstormProjects"),
        );
    });

    it("lists nothing when the file carries every optional key", () => {
        const env = { AUTONOMOUS_CONFIG: "/fake/config.json" };
        const result = loadConfig(env, () => JSON.stringify(valid()));
        expect(result.ok && result.defaulted).toEqual([]);
    });

    it("names the file when an optional key is invalid", () => {
        const env = { AUTONOMOUS_CONFIG: "/fake/config.json" };
        const input = { ...valid(), sessions: { tool: "opencode" } };
        const result = loadConfig(env, () => JSON.stringify(input));
        expect(result).toEqual({
            ok: false,
            path: "/fake/config.json",
            error: `/fake/config.json: ${MISMATCH}$.sessions.tool must be "claude" or "codex"`,
        });
    });

    it("reports invalid JSON with the path", () => {
        const env = { AUTONOMOUS_CONFIG: "/fake/config.json" };
        const readFile = () => "not json";
        const result = loadConfig(env, readFile);
        expect(result.ok).toBe(false);
        expect(!result.ok && result.error).toContain("/fake/config.json");
    });
});

describe("config.example.json", () => {
    it("parses as a valid autonomous.config.v1 document", () => {
        const raw = readFileSync(EXAMPLE_PATH, "utf8");
        const result = parseConfig(JSON.parse(raw));
        expect(result.ok).toBe(true);
        expect(result.ok && result.value.selection).toEqual({ model: "sonnet", effort: "high" });
    });

    it("carries every optional key, so nothing takes a default", () => {
        const raw = readFileSync(EXAMPLE_PATH, "utf8");
        const result = parseConfig(JSON.parse(raw));
        expect(result.ok && result.defaulted).toEqual([]);
    });
});
