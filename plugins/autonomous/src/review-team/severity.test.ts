import { describe, expect, it } from "vitest";

import { deriveSeverity, SEVERITY_TABLES } from "./severity.ts";
import { REVIEWER_IDS, type ReviewerId, SEVERITIES } from "./types.ts";

const TABLES: ReadonlyArray<[ReviewerId, Record<string, string>]> = [
    ["code-review", { important: "CRITICAL", pre_existing: "WARNING", nit: "SUGGESTION" }],
    ["codex", { P0: "CRITICAL", P1: "CRITICAL", P2: "WARNING", P3: "SUGGESTION" }],
    [
        "coderabbit",
        {
            critical: "CRITICAL",
            major: "WARNING",
            minor: "SUGGESTION",
            trivial: "SUGGESTION",
            info: "SUGGESTION",
            none: "SUGGESTION",
        },
    ],
    ["security-review", { High: "CRITICAL", Medium: "WARNING", Low: "SUGGESTION" }],
    [
        "fallow-review",
        { block: "CRITICAL", address: "WARNING", consider: "SUGGESTION", fyi: "SUGGESTION" },
    ],
];
const IDENTITY_REVIEWERS: ReviewerId[] = ["walkthrough", "tests-lens"];

describe("severity tables of the external reviewers", () => {
    it.each(TABLES)("maps every native severity of %s", (reviewer, expected) => {
        expect(SEVERITY_TABLES[reviewer]).toEqual(expected);
        for (const [native, severity] of Object.entries(expected)) {
            expect(deriveSeverity(reviewer, native)).toBe(severity);
        }
    });
});

describe("pre-existing bug", () => {
    it("is a warning", () => {
        expect(deriveSeverity("code-review", "pre_existing")).toBe("WARNING");
    });
});

describe("the plugin's own reviewers", () => {
    it.each(IDENTITY_REVIEWERS)("%s reports on the scale directly", (reviewer) => {
        for (const severity of SEVERITIES) {
            expect(deriveSeverity(reviewer, severity)).toBe(severity);
        }
        expect(deriveSeverity(reviewer, "important")).toBeUndefined();
    });
});

describe("unknown native severity", () => {
    it.each(REVIEWER_IDS)("is not derived for %s", (reviewer) => {
        expect(deriveSeverity(reviewer, "catastrophic")).toBeUndefined();
        expect(deriveSeverity(reviewer, "")).toBeUndefined();
    });

    it("does not match a word of another reviewer's table", () => {
        expect(deriveSeverity("codex", "major")).toBeUndefined();
        expect(deriveSeverity("coderabbit", "P1")).toBeUndefined();
    });

    it("is case-sensitive and ignores inherited object keys", () => {
        expect(deriveSeverity("codex", "p1")).toBeUndefined();
        expect(deriveSeverity("code-review", "toString")).toBeUndefined();
        expect(deriveSeverity("code-review", "__proto__")).toBeUndefined();
    });
});

describe("coverage of the tables", () => {
    it("has a table for every reviewer, mapping only onto the scale", () => {
        expect(Object.keys(SEVERITY_TABLES).sort()).toEqual([...REVIEWER_IDS].sort());
        for (const table of Object.values(SEVERITY_TABLES)) {
            for (const severity of Object.values(table)) {
                expect(SEVERITIES).toContain(severity);
            }
        }
    });
});
