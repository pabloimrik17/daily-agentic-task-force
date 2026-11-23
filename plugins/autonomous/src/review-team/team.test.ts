import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { resolveTeam } from "./team.ts";
import type { ReviewConfig } from "./types.ts";

function shippedReview(): ReviewConfig {
    const file = new URL("../../config.defaults.json", import.meta.url);
    return (JSON.parse(readFileSync(file, "utf8")) as { review: ReviewConfig }).review;
}

const shippedTeam = (): ReviewConfig["team"] => shippedReview().team;
const SECURITY = shippedReview().security;

describe("resolveTeam", () => {
    it("Tier M: the walkthrough, code-review at high, codex and coderabbit, no tests lens and no fallow-review", () => {
        const team = resolveTeam("M", shippedTeam(), SECURITY, false);
        expect(team.map((row) => row.reviewer).sort()).toEqual([
            "code-review",
            "coderabbit",
            "codex",
            "walkthrough",
        ]);
        expect(team.find((row) => row.reviewer === "code-review")).toEqual({
            reviewer: "code-review",
            level: "high",
            model: "opus",
            effort: "high",
        });
    });

    it("Tier L: adds the tests lens, and never fallow-review", () => {
        const reviewers = resolveTeam("L", shippedTeam(), SECURITY, false).map((r) => r.reviewer);
        expect(reviewers).toContain("tests-lens");
        expect(reviewers).not.toContain("fallow-review");
    });

    it("adds the security reviewer when triggered, at any tier, on review.security's model and effort", () => {
        const team = resolveTeam("S", shippedTeam(), SECURITY, true);
        expect(team.at(-1)).toEqual({ reviewer: "security-review", model: "opus", effort: "high" });
        expect(team).toHaveLength(shippedTeam().S.length + 1);
    });

    it("gives the security row no model or effort when review.security names none", () => {
        const security = { pathPatterns: [], linePatterns: [] };
        expect(resolveTeam("S", shippedTeam(), security, true).at(-1)).toEqual({
            reviewer: "security-review",
        });
    });

    it("does not add it when not triggered", () => {
        const team = resolveTeam("S", shippedTeam(), SECURITY, false);
        expect(team.some((row) => row.reviewer === "security-review")).toBe(false);
    });

    it("does not duplicate a security row the tier already lists", () => {
        const rows = [
            { reviewer: "walkthrough" as const },
            { reviewer: "security-review" as const, effort: "high" },
        ];
        const table = { S: rows, M: rows, L: rows };
        expect(resolveTeam("M", table, SECURITY, true)).toEqual(rows);
    });

    it("returns a copy, so a caller cannot change the table", () => {
        const table = { S: [], M: [], L: [{ reviewer: "walkthrough" as const }] };
        resolveTeam("L", table, SECURITY, true).pop();
        expect(resolveTeam("L", table, SECURITY, false)).toEqual(table.L);
    });
});
