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
    shippedReview,
} from "./config.ts";
import type { Tier } from "./review-team/types.ts";
import type { Json } from "./validate.ts";

const REVIEW = {
    tiers: { S: { maxLines: 150, maxFiles: 5 }, M: { maxLines: 600, maxFiles: 20 } },
    team: {
        S: [{ reviewer: "walkthrough" }, { reviewer: "code-review", level: "medium" }],
        M: [{ reviewer: "walkthrough" }, { reviewer: "codex", effort: "medium" }],
        L: [{ reviewer: "walkthrough" }, { reviewer: "tests-lens" }],
    },
    security: { pathPatterns: ["auth"], linePatterns: ["\\beval\\s*\\("] },
    external: {
        waitMinutes: 30,
        answerWaitMinutes: 10,
        rounds: 3,
        bots: [
            { id: "coderabbit", login: "coderabbitai[bot]", check: "CodeRabbit", mention: null },
            {
                id: "greptile",
                login: "greptile-apps[bot]",
                check: "Greptile Review",
                mention: null,
            },
            { id: "pullfrog", login: "pullfrog[bot]", check: "pullfrog", mention: "@pullfrog" },
        ],
    },
};

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
    runner: { grills: 1, parallel: 2, intervalMinutes: 10 },
    review: structuredClone(REVIEW),
});

const withoutOptional = (): Record<string, unknown> => {
    const input: Record<string, unknown> = valid();
    delete input.sessions;
    delete input.workspace;
    delete input.naming;
    delete input.runner;
    delete input.review;
    return input;
};

const ALL_DEFAULTED = [
    "sessions.tool",
    "sessions.profile",
    "sessions.binary",
    "workspace.root",
    "naming.model",
    "naming.effort",
    "runner.grills",
    "runner.parallel",
    "runner.intervalMinutes",
    "review.tiers",
    "review.team",
    "review.security",
    "review.external",
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

    it("rejects an alias for triage-me with the alias's path", () => {
        const input = valid();
        (input.sources.beads.aliases as Record<string, string[]>)["triage-me"] = ["needs-human"];
        const result = parseConfig(input);
        expect(result).toEqual({
            ok: false,
            error: "configuration does not match autonomous.config.v1: $.sources.beads.aliases.triage-me is not a recognised field",
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
    it("fills every key of a file without the blocks and lists every path", () => {
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
        expect(result.ok && result.value.runner).toEqual({
            grills: 1,
            parallel: 2,
            intervalMinutes: 10,
        });
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
        ["runner", { extra: true }, "$.runner.extra"],
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
        ["runner", "$.runner"],
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
            runner: { grills: 1, parallel: 2, intervalMinutes: 10 },
            review: {
                tiers: { S: { maxLines: 150, maxFiles: 5 }, M: { maxLines: 600, maxFiles: 20 } },
                team: {
                    S: [
                        { reviewer: "walkthrough", model: "opus", effort: "medium" },
                        { reviewer: "code-review", level: "medium", model: "opus", effort: "high" },
                        { reviewer: "codex", effort: "medium" },
                    ],
                    M: [
                        { reviewer: "walkthrough", model: "opus", effort: "medium" },
                        { reviewer: "code-review", level: "high", model: "opus", effort: "high" },
                        { reviewer: "codex", effort: "medium" },
                        { reviewer: "coderabbit" },
                    ],
                    L: [
                        { reviewer: "walkthrough", model: "opus", effort: "medium" },
                        { reviewer: "code-review", level: "xhigh", model: "opus", effort: "high" },
                        { reviewer: "codex", effort: "high" },
                        { reviewer: "coderabbit" },
                        { reviewer: "tests-lens", model: "opus", effort: "high" },
                    ],
                },
                security: {
                    model: "opus",
                    effort: "high",
                    pathPatterns: expect.arrayContaining([
                        "auth",
                        "(^|/)\\.env(\\.|$)",
                    ]) as string[],
                    linePatterns: expect.arrayContaining(["\\beval\\s*\\("]) as string[],
                },
                external: REVIEW.external,
            },
        });
    });

    it("keeps the other runner defaults when one key is set", () => {
        const input = { ...withoutOptional(), runner: { parallel: 0 } };
        const result = parseConfig(input);
        expect(result.ok && result.value.runner).toEqual({
            grills: 1,
            parallel: 0,
            intervalMinutes: 10,
        });
        expect(result.ok && result.defaulted).toEqual([
            ...ALL_DEFAULTED.slice(0, 6),
            "runner.grills",
            "runner.intervalMinutes",
            ...ALL_DEFAULTED.slice(9),
        ]);
    });

    it.each([
        [{ grills: -1 }, "$.runner.grills must be an integer >= 0"],
        [{ parallel: -1 }, "$.runner.parallel must be an integer >= 0"],
        [{ parallel: 1.5 }, "$.runner.parallel must be an integer >= 0"],
        [{ intervalMinutes: 2.5 }, "$.runner.intervalMinutes must be an integer >= 1"],
        [{ intervalMinutes: 0 }, "$.runner.intervalMinutes must be an integer >= 1"],
        [{ grills: "1" }, "$.runner.grills must be a finite number"],
    ])("rejects the runner keys %j with their path", (runner, message) => {
        const result = parseConfig({ ...valid(), runner });
        expect(result).toEqual({ ok: false, error: `${MISMATCH}${message}` });
    });

    it("accepts a limit of zero", () => {
        const result = parseConfig({ ...valid(), runner: { ...valid().runner, grills: 0 } });
        expect(result.ok && result.value.runner.grills).toBe(0);
    });

    it("uses the defaults it is given", () => {
        const defaults = {
            sessions: { tool: "codex", profile: "p", binary: "b" },
            workspace: { root: "/srv" },
            naming: { model: "m", effort: "max" },
            runner: { grills: 4, parallel: 5, intervalMinutes: 6 },
            review: REVIEW,
        };
        const result = parseConfig(withoutOptional(), defaults);
        expect(result.ok && result.value.sessions).toEqual({
            tool: "codex",
            profile: "p",
            binary: "b",
        });
        expect(result.ok && result.value.workspace.root).toBe("/srv");
        expect(result.ok && result.value.runner).toEqual({
            grills: 4,
            parallel: 5,
            intervalMinutes: 6,
        });
    });
});

describe("the review block", () => {
    it("takes the shipped review keys when the block is omitted, and lists them", () => {
        const result = parseConfig(withoutOptional(), undefined, "/home/me");
        expect(result.ok && result.defaulted.filter((key) => key.startsWith("review."))).toEqual([
            "review.tiers",
            "review.team",
            "review.security",
            "review.external",
        ]);
        expect(result.ok && result.value.review.tiers.S).toEqual({ maxLines: 150, maxFiles: 5 });
        expect(result.ok && result.value.review.team.M.map((row) => row.reviewer)).toEqual([
            "walkthrough",
            "code-review",
            "codex",
            "coderabbit",
        ]);
    });

    it("lets a user's team replace the whole table and keeps the other keys shipped", () => {
        const team = { ...REVIEW.team, S: [{ reviewer: "codex", model: "gpt-x" }] };
        const result = parseConfig({ ...withoutOptional(), review: { team } });
        expect(result.ok && result.value.review.team).toEqual(team);
        expect(result.ok && result.value.review.tiers.M.maxFiles).toBe(20);
        expect(result.ok && result.defaulted.filter((key) => key.startsWith("review."))).toEqual([
            "review.tiers",
            "review.security",
            "review.external",
        ]);
    });

    it("lists nothing for the review block when the file sets every key", () => {
        const result = parseConfig(valid());
        expect(result.ok && result.value.review).toEqual(REVIEW);
        expect(result.ok && result.defaulted).toEqual([]);
    });

    it("rejects a mistyped review key with its path", () => {
        const review = {
            ...REVIEW,
            tiers: { ...REVIEW.tiers, M: { maxLines: "many", maxFiles: 20 } },
        };
        expect(parseConfig({ ...valid(), review })).toEqual({
            ok: false,
            error: `${MISMATCH}$.review.tiers.M.maxLines must be a finite number`,
        });
    });

    it("rejects an unknown key of the review block with its path", () => {
        const result = parseConfig({ ...valid(), review: { ...REVIEW, tier: {} } });
        expect(result).toEqual({
            ok: false,
            error: `${MISMATCH}$.review.tier is not a recognised field`,
        });
    });

    it("rejects a review block that is not an object", () => {
        expect(parseConfig({ ...valid(), review: [] })).toEqual({
            ok: false,
            error: `${MISMATCH}$.review must be an object`,
        });
    });
});

describe("review bot settings", () => {
    const rejected = (external: unknown): string => {
        const result = parseConfig({ ...valid(), review: { ...REVIEW, external } });
        if (result.ok) {
            throw new Error("accepted");
        }
        return result.error.replace(MISMATCH, "");
    };
    const coderabbit = REVIEW.external.bots[0];
    const withBots = (bots: unknown[]) => ({ ...REVIEW.external, bots });

    it("Block omitted: the three shipped bots are expected and the defaulted keys are listed", () => {
        const result = parseConfig(withoutOptional());
        const external = result.ok && result.value.review.external;
        expect(external).toEqual(REVIEW.external);
        expect(external && external.bots.map((bot) => bot.id)).toEqual([
            "coderabbit",
            "greptile",
            "pullfrog",
        ]);
        expect(result.ok && result.defaulted).toContain("review.external");
    });

    it("Block omitted from a review block that sets the other keys", () => {
        const { external: _external, ...others } = REVIEW;
        const result = parseConfig({ ...valid(), review: others });
        expect(result.ok && result.value.review.external.rounds).toBe(3);
        expect(result.ok && result.defaulted).toEqual(["review.external"]);
    });

    it("One bot configured: only that bot is expected, and the other keys take their default", () => {
        const external = { bots: [coderabbit] };
        const result = parseConfig({ ...valid(), review: { ...REVIEW, external } });
        expect(result.ok && result.value.review.external).toEqual({
            waitMinutes: 30,
            answerWaitMinutes: 10,
            rounds: 3,
            bots: [coderabbit],
        });
        expect(result.ok && result.defaulted).toEqual([
            "review.external.waitMinutes",
            "review.external.answerWaitMinutes",
            "review.external.rounds",
        ]);
    });

    it("Invalid values: a negative waitMinutes is rejected with its path", () => {
        expect(rejected({ ...REVIEW.external, waitMinutes: -1 })).toBe(
            "$.review.external.waitMinutes must be an integer >= 0",
        );
    });

    it("Invalid values: a rounds below 1 is rejected with its path", () => {
        expect(rejected({ ...REVIEW.external, rounds: 0 })).toBe(
            "$.review.external.rounds must be an integer >= 1",
        );
    });

    it("Invalid values: an unknown key under review.external is rejected with its path", () => {
        expect(rejected({ ...REVIEW.external, wait: 5 })).toBe(
            "$.review.external.wait is not a recognised field",
        );
    });

    it("Invalid values: a bad bot names the path of its key", () => {
        expect(rejected(withBots([{ ...coderabbit, login: "" }]))).toBe(
            "$.review.external.bots[0].login must not be empty",
        );
        expect(rejected(withBots([{ ...coderabbit, mention: 3 }]))).toBe(
            "$.review.external.bots[0].mention must be a string or null",
        );
        expect(rejected(withBots([{ ...coderabbit, nick: "cr" }]))).toBe(
            "$.review.external.bots[0].nick is not a recognised field",
        );
    });

    it("Invalid values: a bot that is not an object, and a bots list that is not an array", () => {
        expect(rejected(withBots(["coderabbit"]))).toBe(
            "$.review.external.bots[0] must be an object",
        );
        expect(rejected({ ...REVIEW.external, bots: {} })).toBe(
            "$.review.external.bots must be an array",
        );
    });

    it("Duplicate id: the configuration is rejected with the path of the second entry", () => {
        const greptile = { id: "greptile", login: "g[bot]", check: "G", mention: "@greptile" };
        expect(rejected(withBots([greptile, coderabbit, { ...greptile, check: "G2" }]))).toBe(
            "$.review.external.bots[2].id repeats greptile (already at $.review.external.bots[0])",
        );
    });

    it("keeps a mention string", () => {
        const bot = { ...coderabbit, mention: "@coderabbitai" };
        const result = parseConfig({
            ...valid(),
            review: { ...REVIEW, external: withBots([bot]) },
        });
        expect(result.ok && result.value.review.external.bots).toEqual([bot]);
    });
});

describe("review block validation", () => {
    const shipped = shippedReview();
    // The shipped block with some of its keys replaced: `change` holds the replacements.
    const mistake = (change: Json): string => {
        const result = parseConfig({ ...valid(), review: { ...shipped, ...change } });
        if (result.ok) {
            throw new Error("accepted");
        }
        return result.error.replace(MISMATCH, "");
    };
    const withRow = (tier: Tier, index: number, row: unknown): Json => ({
        team: {
            ...shipped.team,
            [tier]: shipped.team[tier].map((r, i) => (i === index ? row : r)),
        },
    });
    const withSecurity = (change: Json): Json => ({ security: { ...shipped.security, ...change } });
    const { M: _m, ...onlyS } = shipped.tiers;
    const { L: _l, ...withoutL } = shipped.team;

    it("accepts the shipped block", () => {
        const result = parseConfig({ ...valid(), review: { ...shipped } });
        expect(result.ok && result.value.review).toEqual(shipped);
    });

    it("rejects a reviewer repeated within a tier, naming the repeated row", () => {
        const S = [{ reviewer: "codex" }, { reviewer: "walkthrough" }, { reviewer: "codex" }];
        expect(mistake({ team: { ...shipped.team, S } })).toBe(
            "$.review.team.S[2].reviewer repeats codex (already at $.review.team.S[0])",
        );
    });

    it("accepts the same reviewer in different tiers", () => {
        const team = { ...shipped.team, S: [{ reviewer: "codex" }], M: [{ reviewer: "codex" }] };
        const result = parseConfig({ ...valid(), review: { ...shipped, team } });
        expect(result.ok && result.value.review.team.M).toEqual([{ reviewer: "codex" }]);
    });

    it.each([
        ["a zero", 0],
        ["a fraction", 1.5],
        ["a negative", -1],
    ])("rejects %s as a maxFiles", (_name, value) => {
        const tiers = { ...shipped.tiers, M: { ...shipped.tiers.M, maxFiles: value } };
        expect(mistake({ tiers })).toBe("$.review.tiers.M.maxFiles must be an integer >= 1");
    });

    it("rejects a missing tier threshold, an unknown tier and an unknown threshold key", () => {
        expect(mistake({ tiers: onlyS })).toBe("$.review.tiers.M must be an object");
        expect(mistake({ tiers: { ...shipped.tiers, L: {} } })).toBe(
            "$.review.tiers.L is not a recognised field",
        );
        const tiers = { ...shipped.tiers, S: { ...shipped.tiers.S, maxBytes: 1 } };
        expect(mistake({ tiers })).toBe("$.review.tiers.S.maxBytes is not a recognised field");
    });

    it("rejects a team without one of S, M or L, and an extra tier", () => {
        expect(mistake({ team: withoutL })).toBe("$.review.team.L must be an array");
        expect(mistake({ team: { ...shipped.team, XL: [] } })).toBe(
            "$.review.team.XL is not a recognised field",
        );
    });

    it("rejects an empty tier", () => {
        expect(mistake({ team: { ...shipped.team, S: [] } })).toBe(
            "$.review.team.S must not be empty",
        );
    });

    it.each([
        [{ reviewer: "bugbot" }, "$.review.team.S[1].reviewer must be one of "],
        [{ reviewer: 3 }, "$.review.team.S[1].reviewer must be a string"],
        [
            { reviewer: "codex", effort: "fast" },
            "$.review.team.S[1].effort must be one of low, medium, high, xhigh, max",
        ],
        [
            { reviewer: "code-review", level: "ultra" },
            "$.review.team.S[1].level must be one of low, medium, high, xhigh, max",
        ],
        [{ reviewer: "codex", model: "" }, "$.review.team.S[1].model must not be empty"],
        [{ reviewer: "codex", model: 4 }, "$.review.team.S[1].model must be a string"],
        [{ reviewer: "codex", flags: [] }, "$.review.team.S[1].flags is not a recognised field"],
    ])("rejects the row %j", (row, message) => {
        expect(mistake(withRow("S", 1, row))).toContain(message);
    });

    it("rejects a row that is not an object", () => {
        expect(mistake(withRow("S", 0, "codex"))).toBe("$.review.team.S[0] must be an object");
    });

    it("accepts a row with a model, an effort and a level", () => {
        const row = { reviewer: "code-review", model: "opus", effort: "max", level: "max" };
        const result = parseConfig({ ...valid(), review: { ...shipped, ...withRow("S", 1, row) } });
        expect(result.ok && result.value.review.team.S[1]).toEqual(row);
    });

    it("rejects a pattern that does not compile, with its index", () => {
        const linePatterns = [...shipped.security.linePatterns];
        linePatterns[1] = "(unclosed";
        expect(mistake(withSecurity({ linePatterns }))).toBe(
            "$.review.security.linePatterns[1] must be a valid regular expression",
        );
    });

    it("rejects an empty pattern, which would match every path", () => {
        expect(mistake(withSecurity({ pathPatterns: [""] }))).toBe(
            "$.review.security.pathPatterns[0] must not be empty",
        );
    });

    it("rejects a pattern that is not a string and an unknown security key", () => {
        expect(mistake(withSecurity({ pathPatterns: [7] }))).toBe(
            "$.review.security.pathPatterns[0] must be a string",
        );
        expect(mistake(withSecurity({ globs: [] }))).toBe(
            "$.review.security.globs is not a recognised field",
        );
    });

    it("rejects a security effort that is not one of the efforts, with its path", () => {
        expect(mistake(withSecurity({ effort: "huge" }))).toBe(
            "$.review.security.effort must be one of low, medium, high, xhigh, max",
        );
        expect(mistake(withSecurity({ effort: 3 }))).toBe(
            "$.review.security.effort must be a string",
        );
    });

    it("rejects an empty security model, with its path", () => {
        expect(mistake(withSecurity({ model: "" }))).toBe(
            "$.review.security.model must not be empty",
        );
    });

    it("accepts a security block with no model and no effort", () => {
        const security = { pathPatterns: ["auth"], linePatterns: [] };
        const result = parseConfig({ ...valid(), review: { ...shipped, security } });
        expect(result.ok && result.value.review.security).toEqual(security);
    });

    it("accepts empty pattern lists, which turn the security trigger off", () => {
        const security = { pathPatterns: [], linePatterns: [] };
        const result = parseConfig({ ...valid(), review: { ...shipped, security } });
        expect(result.ok && result.value.review.security).toEqual(security);
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
        expect(!result.ok && result.missing).toBe(true);
    });

    it("does not mark a file that fails validation as missing", () => {
        const result = loadConfig({ AUTONOMOUS_CONFIG: "/fake/config.json" }, () => "{}");
        expect(result.ok).toBe(false);
        expect(!result.ok && result.missing).toBeUndefined();
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
