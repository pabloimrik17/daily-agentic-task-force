import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
    CONFIG_SCHEMA,
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
});

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

    it("rejects an unknown field inside judgement", () => {
        const input = { ...valid(), judgement: { ...valid().judgement, extra: true } };
        const result = parseConfig(input);
        expect(result).toEqual({
            ok: false,
            error: "configuration does not match autonomous.config.v1: $.judgement.extra is not a recognised field",
        });
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
    });
});
