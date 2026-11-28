import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { REGISTRY } from "./registry.ts";
import { SEVERITY_TABLES } from "./severity.ts";
import { REVIEWER_IDS, type ReviewConfig } from "./types.ts";

function shippedTeam(): ReviewConfig["team"] {
    const file = new URL("../../config.defaults.json", import.meta.url);
    return (JSON.parse(readFileSync(file, "utf8")) as { review: ReviewConfig }).review.team;
}

describe("REGISTRY", () => {
    it("has one entry per reviewer id, under its own id", () => {
        expect(Object.keys(REGISTRY).sort()).toEqual([...REVIEWER_IDS].sort());
        for (const id of REVIEWER_IDS) {
            expect(REGISTRY[id].id).toBe(id);
        }
    });

    it("requires the walkthrough and the tests lens only", () => {
        const required = REVIEWER_IDS.filter((id) => REGISTRY[id].required);
        expect(required.sort()).toEqual(["tests-lens", "walkthrough"]);
    });

    it("runs codex and coderabbit as CLIs and the rest as teammates with a brief", () => {
        for (const id of REVIEWER_IDS) {
            const entry = REGISTRY[id];
            const isCli = id === "codex" || id === "coderabbit";
            expect(entry.kind).toBe(isCli ? "cli" : "teammate");
            expect(entry.brief).toBe(isCli ? undefined : `${id}.md`);
        }
    });

    it("names the engine tool and takes the severity table of the reviewer", () => {
        expect(REGISTRY.codex.tool).toBe("codex");
        expect(REGISTRY.coderabbit.tool).toBe("coderabbit");
        expect(REGISTRY["code-review"].tool).toBe("claude-code");
        for (const id of REVIEWER_IDS) {
            expect(REGISTRY[id].severity).toBe(SEVERITY_TABLES[id]);
        }
    });

    it("gives every tier row of the shipped table a registry entry", () => {
        const team = shippedTeam();
        for (const tier of ["S", "M", "L"] as const) {
            expect(team[tier].length).toBeGreaterThan(0);
            for (const row of team[tier]) {
                expect(REGISTRY[row.reviewer]).toBeDefined();
            }
        }
    });
});
