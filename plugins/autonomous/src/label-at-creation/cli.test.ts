import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { config } from "../label-triage/test-fixtures.ts";
import { buildPrompt } from "../label-triage/judgement.ts";
import { main, USAGE } from "./cli.ts";

function invoke(argv: string[], readConfig = () => JSON.stringify(config())) {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const code = main(argv, {
        env: { AUTONOMOUS_CONFIG: "/home/me/.config/autonomous/config.json" },
        readConfig,
        stdout: (value) => stdout.push(value),
        stderr: (value) => stderr.push(value),
    });
    return { code, stdout, stderr };
}

describe("label-at-creation CLI", () => {
    it("prepares using the exact criteria bytes embedded in the triage prompt", () => {
        const result = invoke(["prepare", "--source", "linear"]);
        const criteria = readFileSync(
            new URL("../label-triage/criteria.md", import.meta.url),
            "utf8",
        );
        expect(result.code).toBe(0);
        expect(result.stdout[0]).toBe(criteria);
        expect(buildPrompt([]).startsWith(`${criteria}\n`)).toBe(true);
        expect(result.stdout[1]).toContain("scope: derived personal");
    });

    it("decides using the configured threshold", () => {
        const result = invoke(["decide", "--source", "linear", "--judged", "entry=AFK@0.97"]);
        expect(result.code).toBe(0);
        expect(result.stdout).toEqual(["apply: personal, AFK"]);
    });

    it.each([
        [["prepare", "--source", "other"], "--source"],
        [["prepare", "--source", "github"], "--repo is required"],
        [["prepare", "--source", "linear", "--repo", "owner/repo"], "--repo is only"],
        [["prepare", "--source", "linear", "--judged", "entry=AFK@0.97"], "--judged is only"],
        [["decide", "--source", "linear", "--judged", "entry=AFK@1.2"], "confidence"],
        [
            [
                "decide",
                "--source",
                "linear",
                "--judged",
                "entry=AFK@0.9",
                "--judged",
                "entry=HITL@0.9",
            ],
            "group given twice",
        ],
    ])("rejects a usage error: %j", (args, error) => {
        const result = invoke(args);
        expect(result.code).toBe(1);
        expect(result.stdout).toEqual([]);
        expect(result.stderr[0]).toContain(error);
        expect(result.stderr[0]).toContain(USAGE);
    });

    it("prints criteria and a decision after an ENOENT config read", () => {
        const result = invoke(
            ["decide", "--source", "linear", "--label", "personal", "--judged", "entry=AFK@1"],
            () => {
                const error = new Error("not found") as NodeJS.ErrnoException;
                error.code = "ENOENT";
                throw error;
            },
        );
        expect(result.code).toBe(0);
        expect(result.stdout[0]).toContain("Every task carries");
        expect(result.stdout[1]).toContain("apply: personal");
        expect(result.stdout[1]).toContain("ask entry:");
        expect(result.stdout[1]).toContain("/home/me/.config/autonomous/config.json");
    });
});
