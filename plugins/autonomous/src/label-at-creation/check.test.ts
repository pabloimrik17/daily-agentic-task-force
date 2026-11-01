import { describe, expect, it } from "vitest";

import { loadConfig, type ConfigLoad } from "../config.ts";
import { config } from "../label-triage/test-fixtures.ts";
import { check, prepare, type CheckInput, type JudgedGroup } from "./check.ts";

const configured: ConfigLoad = {
    ok: true,
    path: "/home/me/.config/autonomous/config.json",
    config: config(),
    defaulted: [],
};

function input(source: CheckInput["source"], labels: string[] = [], repo?: string): CheckInput {
    return { source, labels, ...(repo ? { repo } : {}) };
}

function judged(group: JudgedGroup["group"], labels: string[], confidence: number): JudgedGroup {
    return { group, labels, confidence };
}

// The shipped Linear alias for `grill-me` (config.example.json).
function withGrillAlias(): ConfigLoad {
    const load = { ...configured, config: config() };
    if (load.ok) load.config.sources.linear.aliases = { "grill-me": ["Grill Me"] };
    return load;
}

describe("Helper reports the state of each group", () => {
    it("Linear with a structural rule", () => {
        expect(prepare(input("linear"), configured)).toEqual([
            "scope: derived personal (every linear task is personal)",
            "autonomy: judge (AFK, HITL, grill-me)",
            "stage: follows autonomy",
        ]);
    });

    it("Unconfigured GitHub repository", () => {
        const load = { ...configured, config: config() };
        if (load.ok) load.config.sources.github.scope = "personal";
        expect(prepare(input("github", [], "other/repo"), load)).toEqual([
            "scope: judge (work, personal)",
            "autonomy: judge (AFK, HITL, grill-me)",
            "stage: follows autonomy",
            "repository other/repo is not configured; contract labels may not exist there",
        ]);
    });

    it("uses the GitHub structural rule in a configured repository, in any letter case", () => {
        const load = { ...configured, config: config() };
        if (load.ok) load.config.sources.github.scope = "personal";
        for (const repo of ["owner/repo", "Owner/Repo"]) {
            expect(prepare(input("github", [], repo), load)).toEqual([
                "scope: derived personal (every github task is personal)",
                "autonomy: judge (AFK, HITL, grill-me)",
                "stage: follows autonomy",
            ]);
        }
    });

    it("Labels named by the user", () => {
        expect(prepare(input("linear", ["HITL"]), configured)).toEqual([
            "scope: derived personal (every linear task is personal)",
            "autonomy: present HITL",
            "stage: derived proposal (autonomy HITL)",
        ]);
    });

    it("Labels inherited from a parent", () => {
        expect(prepare(input("beads", ["work", "AFK"]), configured)).toEqual([
            "scope: present work",
            "autonomy: present AFK",
            "stage: derived proposal (autonomy AFK)",
        ]);
    });

    it("Grill named by the user", () => {
        expect(prepare(input("linear", ["grill-me"]), configured)).toEqual([
            "scope: derived personal (every linear task is personal)",
            "autonomy: not needed (grill-me)",
            "stage: present grill-me",
        ]);
    });

    it("Both scopes named", () => {
        expect(prepare(input("beads", ["work", "personal"]), configured)[0]).toBe(
            "scope: conflict work, personal",
        );
    });

    it("offers no grill when the task will carry a stage label", () => {
        expect(prepare(input("beads", ["proposal"]), configured)).toEqual([
            "scope: judge (work, personal)",
            "autonomy: judge (AFK, HITL)",
            "stage: present proposal",
        ]);
    });

    it("reports two named stage labels as a conflict, with no grill to offer", () => {
        expect(prepare(input("beads", ["grill-me", "proposal"]), configured)).toEqual([
            "scope: judge (work, personal)",
            "autonomy: judge (AFK, HITL)",
            "stage: conflict grill-me, proposal",
        ]);
    });

    it("reports two named autonomy labels as a conflict and the stage as following it", () => {
        expect(prepare(input("beads", ["work", "AFK", "HITL"]), configured)).toEqual([
            "scope: present work",
            "autonomy: conflict AFK, HITL",
            "stage: follows autonomy",
        ]);
    });

    it("derives the stage from a grill-me alias in the autonomy evidence", () => {
        expect(prepare(input("linear", ["Grill Me"]), withGrillAlias())).toEqual([
            "scope: derived personal (every linear task is personal)",
            "autonomy: derived grill-me (alias Grill Me)",
            "stage: derived grill-me (alias Grill Me)",
        ]);
    });
});

describe("Helper decides what to apply and what to ask", () => {
    it("Confident entry", () => {
        expect(check(input("linear"), configured, [judged("autonomy", ["AFK"], 0.97)])).toEqual([
            "apply: personal, AFK, proposal",
        ]);
    });

    it("Entry below threshold", () => {
        expect(check(input("linear"), configured, [judged("autonomy", ["AFK"], 0.8)])).toEqual([
            "apply: personal",
            "ask autonomy: below threshold 0.95: 0.80; options AFK, HITL, grill-me",
        ]);
    });

    it("Invalid judgement", () => {
        expect(
            check(input("linear"), configured, [judged("autonomy", ["AFK", "HITL"], 0.99)]),
        ).toEqual([
            "apply: personal",
            "ask autonomy: invalid under the contract: AFK with HITL; options AFK, HITL, grill-me",
        ]);
    });

    it("Grill judged", () => {
        expect(
            check(input("linear"), configured, [judged("autonomy", ["grill-me"], 0.97)]),
        ).toEqual(["apply: personal, grill-me"]);
    });

    it("Judgement disagrees with evidence", () => {
        const lines = check(input("linear"), configured, [judged("scope", ["work"], 0.99)]);
        expect(lines[0]).toBe("apply: none");
        expect(lines[1]).toContain(
            "evidence personal (every linear task is personal) disagrees with judgement work",
        );
        expect(lines[2]).toContain("ask autonomy: no judgement given");
    });

    it("One group applied, one asked", () => {
        expect(check(input("linear"), configured, [judged("autonomy", ["AFK"], 0.6)])).toEqual([
            "apply: personal",
            "ask autonomy: below threshold 0.95: 0.60; options AFK, HITL, grill-me",
        ]);
    });

    it("applies a judgement exactly at the threshold", () => {
        expect(check(input("linear"), configured, [judged("autonomy", ["AFK"], 0.95)])[0]).toBe(
            "apply: personal, AFK, proposal",
        );
    });

    it("uses the configured threshold of 0.9", () => {
        const load = { ...configured, config: config() };
        if (load.ok) load.config.judgement.threshold = 0.9;
        expect(check(input("linear"), load, [judged("autonomy", ["AFK"], 0.92)])[0]).toBe(
            "apply: personal, AFK, proposal",
        );
    });

    it("applies a judgement that agrees with evidence", () => {
        expect(check(input("linear"), configured, [judged("scope", ["personal"], 0.1)])[0]).toBe(
            "apply: personal",
        );
    });

    it("brings proposal with an autonomy label the user named", () => {
        expect(check(input("linear", ["HITL"]), configured, [])).toEqual([
            "apply: personal, HITL, proposal",
        ]);
    });

    it("applies the stage the user named and never adds a second one", () => {
        expect(
            check(input("linear", ["proposal"]), configured, [judged("autonomy", ["AFK"], 0.99)]),
        ).toEqual(["apply: personal, AFK, proposal"]);
    });

    it("applies grill-me named by the user with no autonomy to ask about", () => {
        expect(check(input("linear", ["grill-me"]), configured, [])).toEqual([
            "apply: personal, grill-me",
        ]);
    });

    it("asks about grill-me judged for a task that will carry a stage label", () => {
        expect(
            check(input("linear", ["proposal"]), configured, [
                judged("autonomy", ["grill-me"], 0.99),
            ]),
        ).toEqual([
            "apply: personal, proposal",
            "ask autonomy: invalid under the contract: grill-me with a stage label: proposal; options AFK, HITL",
        ]);
    });

    it("applies grill-me alone for a grill-me alias, with no judgement needed", () => {
        expect(check(input("linear", ["Grill Me"]), withGrillAlias(), [])).toEqual([
            "apply: personal, grill-me",
        ]);
    });

    it("asks when the judgement disagrees with a grill-me alias", () => {
        const lines = check(input("linear", ["Grill Me"]), withGrillAlias(), [
            judged("autonomy", ["AFK"], 0.99),
        ]);
        expect(lines[0]).toBe("apply: personal");
        expect(lines[1]).toContain(
            "evidence grill-me (alias Grill Me) disagrees with judgement AFK",
        );
        expect(lines[1]).toContain("options AFK, HITL, grill-me");
    });

    it("Both stages named", () => {
        expect(check(input("linear", ["grill-me", "proposal"]), configured, [])).toEqual([
            "apply: personal",
            "ask autonomy: no judgement given; options AFK, HITL",
            "ask stage: conflicting present labels: grill-me, proposal; options grill-me, proposal",
        ]);
    });

    it("asks about two named autonomy labels and applies no stage", () => {
        expect(check(input("beads", ["work", "AFK", "HITL"]), configured, [])).toEqual([
            "apply: work",
            "ask autonomy: conflicting present labels: AFK, HITL; options AFK, HITL, grill-me",
        ]);
    });
});

describe("Missing configuration degrades to asking", () => {
    it("No configuration file", () => {
        const missing = loadConfig({ AUTONOMOUS_CONFIG: "/missing/config.json" }, () => {
            const error = new Error("not found") as NodeJS.ErrnoException;
            error.code = "ENOENT";
            throw error;
        });
        expect(prepare(input("linear", ["personal"]), missing).join("\n")).toContain(
            "/missing/config.json",
        );
        const result = check(input("linear", ["personal"]), missing, [
            judged("autonomy", ["AFK"], 1),
        ]);
        expect(result[0]).toBe("apply: personal");
        expect(result[1]).toBe(
            "ask autonomy: configuration unavailable; options AFK, HITL, grill-me",
        );
        expect(result[2]).toContain("configuration /missing/config.json:");
        // The stage follows the autonomy and is never asked about on its own.
        expect(result).toHaveLength(3);
    });
});
