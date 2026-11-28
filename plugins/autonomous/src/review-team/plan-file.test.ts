import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { temporaryDirectories } from "../stages/test-fixtures.ts";
import { parsePlan, readPlan } from "./plan-file.ts";
import type { Plan } from "./types.ts";

type Obj = Record<string, unknown>;

function errorOf(result: { ok: true } | { ok: false; error: string }): string {
    return result.ok ? "" : result.error;
}

const directories = temporaryDirectories("review-plan-file");

afterEach(async () => {
    await directories.removeAll();
});

const valid = (): Plan => ({
    schema: "autonomous.review-plan.v1",
    createdAt: "2026-11-22T10:00:00.000Z",
    subject: {
        repo: "my-repo",
        branch: "feature/work",
        base: "main",
        baseSource: "default-branch",
        mergeBase: "1111111",
        head: "2222222",
        dirty: false,
    },
    status: " M README.md\n",
    fingerprint: "0123456789abcdef".repeat(4),
    measure: { lines: 90, files: 3 },
    tier: { measured: "S", used: "L", reason: "label contract" },
    security: {
        triggered: true,
        matches: [{ kind: "line", pattern: "execFile", file: "src/run.ts", line: 12 }],
    },
    team: [
        {
            reviewer: "walkthrough",
            angle: "comprehension",
            kind: "teammate",
            required: true,
            engine: { tool: "claude-code", version: "2.1.0", model: "opus", effort: "high" },
            brief: "briefs/walkthrough.md",
            output: "reviewers/walkthrough.json",
        },
        {
            reviewer: "codex",
            angle: "correctness",
            kind: "cli",
            required: false,
            engine: { tool: "codex", version: "0.169.0" },
            output: "reviewers/codex.json",
        },
    ],
    skipped: [{ reviewer: "coderabbit", reason: "not logged in" }],
    guide: { available: false, reason: "plannotator CLI not found on PATH" },
});

function teamEntry(plan: Plan, extra: Obj): Obj {
    return { ...plan, team: [{ ...plan.team[0], ...extra }] };
}

describe("parsePlan", () => {
    it("accepts a plan and returns it unchanged", () => {
        expect(parsePlan(valid())).toEqual({ ok: true, value: valid() });
    });

    it.each<[string, Obj, string]>([
        ["an unknown key", { ...valid(), extra: 1 }, "$.extra is not a recognised field"],
        [
            "another schema",
            { ...valid(), schema: "x" },
            "$.schema must be one of autonomous.review-plan.v1",
        ],
        [
            "a date that is not one",
            { ...valid(), createdAt: "yesterday" },
            "$.createdAt must be an ISO 8601 date",
        ],
        ["a status that is not text", { ...valid(), status: null }, "$.status must be a string"],
        [
            "no fingerprint",
            { ...valid(), fingerprint: undefined },
            "$.fingerprint must be a string",
        ],
        [
            "a fingerprint in uppercase hex",
            { ...valid(), fingerprint: "0123456789ABCDEF".repeat(4) },
            "$.fingerprint must be 64 lowercase hex characters",
        ],
        [
            "a fingerprint of the wrong length",
            { ...valid(), fingerprint: "0".repeat(63) },
            "$.fingerprint must be 64 lowercase hex characters",
        ],
        [
            "a bad subject",
            { ...valid(), subject: { ...valid().subject, dirty: "no" } },
            "$.subject.dirty must be a boolean",
        ],
        [
            "an unknown reviewer",
            teamEntry(valid(), { reviewer: "lint" }),
            "$.team[0].reviewer must be one of",
        ],
        [
            "an engine with no version",
            teamEntry(valid(), { engine: { tool: "codex" } }),
            "$.team[0].engine.version must be a string",
        ],
        [
            "an absolute output",
            teamEntry(valid(), { output: "/tmp/x.json" }),
            "$.team[0].output must be a path inside the report directory",
        ],
        [
            "an output outside the directory",
            teamEntry(valid(), { output: "../x.json" }),
            "$.team[0].output must be a path inside the report directory",
        ],
        [
            "a skip with no reason",
            { ...valid(), skipped: [{ reviewer: "codex" }] },
            "$.skipped[0].reason must be a string",
        ],
        [
            "a guide with an unknown key",
            { ...valid(), guide: { available: true, path: "x" } },
            "$.guide.path is not a recognised field",
        ],
    ])("rejects %s, naming its path", (_name, input, error) => {
        const result = parsePlan(input);

        expect(result.ok).toBe(false);
        expect(!result.ok && result.error).toContain(error);
    });
});

describe("readPlan", () => {
    it("reads plan.json from the report directory", () => {
        const dir = directories.make("dir");
        writeFileSync(join(dir, "plan.json"), JSON.stringify(valid()));

        expect(readPlan(dir)).toEqual({ ok: true, value: valid() });
    });

    it("names what went wrong: no file, not JSON, not a plan", () => {
        const dir = directories.make("dir");

        expect(errorOf(readPlan(dir))).toMatch(/^reading plan\.json: ENOENT/);
        writeFileSync(join(dir, "plan.json"), "{");
        expect(errorOf(readPlan(dir))).toMatch(/^reading plan\.json: /);
        writeFileSync(join(dir, "plan.json"), "[]");
        expect(readPlan(dir)).toEqual({
            ok: false,
            error: "plan.json is not valid: $ must be an object",
        });
    });
});
