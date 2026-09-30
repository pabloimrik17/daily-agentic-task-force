import { describe, expect, it } from "vitest";

import { loadConfig, type ConfigLoad } from "../config.ts";
import { config } from "../label-triage/test-fixtures.ts";
import { check, prepare, type CheckInput, type JudgedGroup } from "./check.ts";

const configured: ConfigLoad = {
    ok: true,
    path: "/home/me/.config/autonomous/config.json",
    config: config(),
};

function input(source: CheckInput["source"], labels: string[] = [], repo?: string): CheckInput {
    return { source, labels, ...(repo ? { repo } : {}) };
}

function judged(group: JudgedGroup["group"], labels: string[], confidence: number): JudgedGroup {
    return { group, labels, confidence };
}

describe("prepare", () => {
    it("derives Linear scope from its structural rule", () => {
        expect(prepare(input("linear"), configured)).toEqual([
            "scope: derived personal (every linear task is personal)",
            "entry: judge (AFK, HITL, grill-me)",
        ]);
    });

    it("does not use the GitHub structural rule outside configured repositories", () => {
        const load = { ...configured, config: config() };
        if (load.ok) load.config.sources.github.scope = "personal";
        expect(prepare(input("github", [], "other/repo"), load)).toEqual([
            "scope: judge (work, personal)",
            "entry: judge (AFK, HITL, grill-me)",
            "repository other/repo is not configured; contract labels may not exist there",
        ]);
    });

    it("uses the GitHub structural rule in a configured repository, in any letter case", () => {
        const load = { ...configured, config: config() };
        if (load.ok) load.config.sources.github.scope = "personal";
        for (const repo of ["owner/repo", "Owner/Repo"]) {
            expect(prepare(input("github", [], repo), load)).toEqual([
                "scope: derived personal (every github task is personal)",
                "entry: judge (AFK, HITL, grill-me)",
            ]);
        }
    });

    it("recognises user-named labels and labels inherited from a parent", () => {
        expect(prepare(input("linear", ["HITL"]), configured)[1]).toBe("entry: present HITL");
        expect(prepare(input("beads", ["work", "AFK"]), configured)).toEqual([
            "scope: present work",
            "entry: present AFK",
        ]);
    });

    it("reports two named scopes as a conflict", () => {
        expect(prepare(input("beads", ["work", "personal"]), configured)[0]).toBe(
            "scope: conflict work, personal",
        );
    });
});

describe("decide", () => {
    it("applies a confident entry and the derived scope", () => {
        expect(check(input("linear"), configured, [judged("entry", ["AFK"], 0.97)])).toEqual([
            "apply: personal, AFK",
        ]);
    });

    it("asks about entry below the configured threshold", () => {
        expect(check(input("linear"), configured, [judged("entry", ["AFK"], 0.8)])).toEqual([
            "apply: personal",
            "ask entry: below threshold 0.95: 0.80; options AFK, HITL, grill-me",
        ]);
    });

    it("asks about an invalid judgement", () => {
        expect(
            check(input("linear"), configured, [judged("entry", ["AFK", "HITL"], 0.99)]),
        ).toEqual([
            "apply: personal",
            "ask entry: invalid under the contract: AFK with HITL; options AFK, HITL, grill-me",
        ]);
    });

    it("asks when judgement disagrees with structural evidence", () => {
        const lines = check(input("linear"), configured, [judged("scope", ["work"], 0.99)]);
        expect(lines[0]).toBe("apply: none");
        expect(lines[1]).toContain(
            "evidence personal (every linear task is personal) disagrees with judgement work",
        );
        expect(lines[2]).toContain("ask entry: no judgement given");
    });

    it("applies the derived group independently of a low-confidence group", () => {
        expect(check(input("linear"), configured, [judged("entry", ["AFK"], 0.6)])[0]).toBe(
            "apply: personal",
        );
    });

    it("applies a judgement exactly at the threshold", () => {
        expect(check(input("linear"), configured, [judged("entry", ["AFK"], 0.95)])[0]).toBe(
            "apply: personal, AFK",
        );
    });

    it("uses the configured threshold of 0.9", () => {
        const load = { ...configured, config: config() };
        if (load.ok) load.config.judgement.threshold = 0.9;
        expect(check(input("linear"), load, [judged("entry", ["AFK"], 0.92)])[0]).toBe(
            "apply: personal, AFK",
        );
    });

    it("applies a judgement that agrees with evidence", () => {
        expect(check(input("linear"), configured, [judged("scope", ["personal"], 0.1)])[0]).toBe(
            "apply: personal",
        );
    });

    it("applies present labels but no judgement when configuration is absent", () => {
        const missing = loadConfig({ AUTONOMOUS_CONFIG: "/missing/config.json" }, () => {
            const error = new Error("not found") as NodeJS.ErrnoException;
            error.code = "ENOENT";
            throw error;
        });
        expect(prepare(input("linear", ["personal"]), missing).join("\n")).toContain(
            "/missing/config.json",
        );
        const result = check(input("linear", ["personal"]), missing, [judged("entry", ["AFK"], 1)]);
        expect(result[0]).toBe("apply: personal");
        expect(result[1]).toBe("ask entry: configuration unavailable; options AFK, HITL, grill-me");
        expect(result[2]).toContain("configuration /missing/config.json:");
    });
});
