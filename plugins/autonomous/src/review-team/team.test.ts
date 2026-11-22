import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { resolveTeam } from "./team.ts";
import type { ReviewConfig } from "./types.ts";

function shippedTeam(): ReviewConfig["team"] {
    const file = new URL("../../config.defaults.json", import.meta.url);
    return (JSON.parse(readFileSync(file, "utf8")) as { review: ReviewConfig }).review.team;
}

describe("resolveTeam", () => {
    it("Tier M: the walkthrough, code-review at high, codex, coderabbit and fallow-review, no tests lens", () => {
        const team = resolveTeam("M", shippedTeam(), false);
        expect(team.map((row) => row.reviewer).sort()).toEqual([
            "code-review",
            "coderabbit",
            "codex",
            "fallow-review",
            "walkthrough",
        ]);
        expect(team.find((row) => row.reviewer === "code-review")?.level).toBe("high");
    });

    it("adds the security reviewer when triggered, at any tier", () => {
        const team = resolveTeam("S", shippedTeam(), true);
        expect(team.at(-1)).toEqual({ reviewer: "security-review" });
        expect(team).toHaveLength(shippedTeam().S.length + 1);
    });

    it("does not add it when not triggered", () => {
        const team = resolveTeam("S", shippedTeam(), false);
        expect(team.some((row) => row.reviewer === "security-review")).toBe(false);
    });

    it("does not duplicate a security row the tier already lists", () => {
        const rows = [
            { reviewer: "walkthrough" as const },
            { reviewer: "security-review" as const, effort: "high" },
        ];
        const table = { S: rows, M: rows, L: rows };
        expect(resolveTeam("M", table, true)).toEqual(rows);
    });

    it("returns a copy, so a caller cannot change the table", () => {
        const table = { S: [], M: [], L: [{ reviewer: "walkthrough" as const }] };
        resolveTeam("L", table, true).pop();
        expect(resolveTeam("L", table, false)).toEqual(table.L);
    });
});
