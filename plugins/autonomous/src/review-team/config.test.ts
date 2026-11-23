import { describe, expect, it } from "vitest";

import { CONFIG_SCHEMA } from "../config.ts";
import { loadReviewConfig } from "./config.ts";

const ENV = { AUTONOMOUS_CONFIG: "/fake/config.json", HOME: "/home/me" };
const MISMATCH = "configuration does not match autonomous.config.v1: ";

const base = () => ({
    schema: CONFIG_SCHEMA,
    sources: {
        linear: { enabled: false },
        beads: { enabled: false, directory: "/path/to/repo" },
        github: { enabled: false, repos: [] },
    },
    judgement: { model: "m", effort: "medium", threshold: 0.95, cap: 25, batch: 20 },
    selection: { model: "sonnet", effort: "high" },
});

const missingFile = () => {
    throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
};

const shippedBlock = () => {
    const result = loadReviewConfig({ AUTONOMOUS_CONFIG: "/none.json" }, missingFile);
    if (!result.ok) {
        throw new Error(result.error);
    }
    return result.value;
};

describe("loadReviewConfig", () => {
    it("runs with the shipped review block when there is no configuration file", () => {
        const result = loadReviewConfig(ENV, missingFile);
        const review = result.ok ? result.value : undefined;
        expect(review?.tiers).toEqual({
            S: { maxLines: 150, maxFiles: 5 },
            M: { maxLines: 600, maxFiles: 20 },
        });
        expect(review?.team.S).toEqual([
            { reviewer: "walkthrough", model: "opus", effort: "medium" },
            { reviewer: "code-review", level: "medium", model: "opus", effort: "high" },
            { reviewer: "codex", effort: "medium" },
        ]);
        expect(review?.team.L.at(-1)).toEqual({
            reviewer: "tests-lens",
            model: "opus",
            effort: "high",
        });
        expect(review?.security).toMatchObject({ model: "opus", effort: "high" });
    });

    it("names opus for every teammate row and no model for the CLI rows, and lists no fallow-review", () => {
        const teammates = ["walkthrough", "code-review", "tests-lens"];
        const rows = Object.values(shippedBlock().team).flat();
        for (const row of rows) {
            expect(row.model).toBe(teammates.includes(row.reviewer) ? "opus" : undefined);
        }
        expect(rows.some((row) => row.reviewer === "fallow-review")).toBe(false);
    });

    it("ships patterns that compile and catch an execFile call and an .env path", () => {
        const { security } = shippedBlock();
        const linePatterns = security.linePatterns.map((source) => new RegExp(source));
        const pathPatterns = security.pathPatterns.map((source) => new RegExp(source, "i"));
        expect(linePatterns.some((re) => re.test('    execFile("git", args);'))).toBe(true);
        expect(linePatterns.some((re) => re.test("const total = a + b;"))).toBe(false);
        expect(pathPatterns.some((re) => re.test("config/.env.local"))).toBe(true);
        expect(pathPatterns.some((re) => re.test("src/Auth/login.ts"))).toBe(true);
        expect(pathPatterns.some((re) => re.test("src/render.ts"))).toBe(false);
    });

    it("uses the review block of an existing file", () => {
        const review = {
            tiers: { S: { maxLines: 10, maxFiles: 2 }, M: { maxLines: 50, maxFiles: 9 } },
        };
        const result = loadReviewConfig(ENV, () => JSON.stringify({ ...base(), review }));
        expect(result.ok && result.value.tiers).toEqual(review.tiers);
    });

    it("stops with the path of an invalid threshold", () => {
        const review = {
            tiers: { S: { maxLines: -1, maxFiles: 5 }, M: { maxLines: 600, maxFiles: 20 } },
        };
        const result = loadReviewConfig(ENV, () => JSON.stringify({ ...base(), review }));
        expect(result).toEqual({
            ok: false,
            error: `/fake/config.json: ${MISMATCH}$.review.tiers.S.maxLines must be an integer >= 1`,
        });
    });

    it("does not fall back to the shipped block for a file that exists but is invalid", () => {
        const result = loadReviewConfig(ENV, () => "{ not json");
        expect(result.ok).toBe(false);
    });

    it("reports a file it cannot read, other than a missing one, as an error", () => {
        const result = loadReviewConfig(ENV, () => {
            throw Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
        });
        expect(result.ok).toBe(false);
    });
});
