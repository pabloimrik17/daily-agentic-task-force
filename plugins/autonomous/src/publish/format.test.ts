import { describe, expect, it } from "vitest";

import {
    continuingReply,
    firstComment,
    normalisedTitle,
    reviewBody,
    sameTitle,
    stateReply,
    titleOf,
} from "./format.ts";
import { parseMarkers, threadMarker } from "./markers.ts";
import { outcomeOf, type Published, publicationOf } from "./outcome.ts";
import type { RecordEntry } from "./record.ts";
import { ATTEMPT, doubt, finding } from "./test-fixtures.ts";

function published(entry: RecordEntry): Published {
    const value = publicationOf(entry);
    if (value === null) {
        throw new Error(`${entry.id} is not published`);
    }
    return value;
}

function first(entry: RecordEntry): string {
    return firstComment(ATTEMPT, entry, published(entry));
}

const CRITICAL = finding({
    id: "f3",
    severity: "CRITICAL",
    reporters: [
        { reviewer: "code-review", ids: ["code-review-1"], engine: "Claude Code 2.1.330" },
        { reviewer: "codex", ids: ["codex-4"], engine: "codex 0.171.0" },
    ],
});

describe("The comment format", () => {
    it("Critical finding: opens with issue (blocking): and its trace names both reporters and CRITICAL", () => {
        expect(first(CRITICAL)).toBe(
            [
                "issue (blocking): The retry loop never stops when the token is revoked.",
                "",
                "A revoked token makes `retry` loop forever.",
                "",
                "Status: fixed in abc1234",
                "<details><summary>Trace</summary>",
                "",
                'Reported by code-review, codex · CRITICAL · reproduction: test/retry.test.ts "stops" · Claude Code 2.1.330, codex 0.171.0',
                "</details>",
                `<!-- autonomous:finding v1 attempt=${ATTEMPT} finding=f3 -->`,
            ].join("\n"),
        );
    });

    it("Doubt: opens with question (blocking): and its thread is open", () => {
        const entry = doubt();
        const body = first(entry);
        expect(body.startsWith("question (blocking): ")).toBe(true);
        expect(published(entry).state).toBe("open");
        expect(body).toContain("Status: open question");
        expect(body).toContain("\nReported by codex · codex 0.171.0\n");
    });

    it("leaves out (blocking) for a WARNING and the reproduction when there is none", () => {
        const entry = finding({
            destination: "pass-on",
            refutation: { outcome: "not-refuted", reproduction: null },
            publication: { state: "passed-on", stage: "qa" },
            reporters: [{ reviewer: "verification", ids: ["V1"] }],
        });
        const body = first(entry);
        expect(body.startsWith("issue: ")).toBe(true);
        expect(body).toContain("\nReported by verification · WARNING\n");
    });
});

describe("A finding passed on is addressed to its stage (format)", () => {
    it("Passed on to QA: shows #qa and carries the marker for=qa", () => {
        const entry = finding({
            id: "f4",
            destination: "pass-on",
            refutation: { outcome: "not-refuted", reproduction: null },
            publication: { state: "passed-on", stage: "qa" },
        });
        const body = first(entry);
        expect(body).toContain("Status: passed on to QA #qa");
        expect(threadMarker(body)).toEqual({
            kind: "finding",
            attempt: ATTEMPT,
            finding: "f4",
            for: "qa",
        });
    });
});

describe("Hidden markers", () => {
    it("Marker of a finding: the first comment names the attempt and the finding", () => {
        expect(threadMarker(first(CRITICAL))).toEqual({
            kind: "finding",
            attempt: ATTEMPT,
            finding: "f3",
        });
    });

    it("marks a doubt's first comment as a doubt", () => {
        expect(threadMarker(first(doubt()))).toMatchObject({ kind: "doubt", finding: "d1" });
    });

    it("a state reply holds the status line and a resolution marker", () => {
        expect(stateReply(ATTEMPT, CRITICAL, published(CRITICAL))).toBe(
            `Status: fixed in abc1234\n<!-- autonomous:resolution v1 attempt=${ATTEMPT} finding=f3 state=fixed -->`,
        );
    });

    it("a reply for a linked entry not published holds its outcome and a resolution marker", () => {
        const refuted = finding({
            id: "f4",
            thread: "E1",
            reason: "The guard stops it.",
            refutation: { outcome: "refuted", reproduction: null },
            publication: { state: "none" },
        });
        const outcome = outcomeOf(refuted);
        if (outcome === null) {
            throw new Error("f4 has no outcome");
        }
        expect(stateReply(ATTEMPT, refuted, outcome)).toBe(
            `Status: not published (refuted): The guard stops it.\n<!-- autonomous:resolution v1 attempt=${ATTEMPT} finding=f4 state=none -->`,
        );
    });

    it("a reply continuing a thread holds the full comment and a resolution marker only", () => {
        const body = continuingReply(ATTEMPT, CRITICAL, published(CRITICAL));
        expect(body.startsWith("issue (blocking): ")).toBe(true);
        expect(body).toContain("<details><summary>Trace</summary>");
        expect(parseMarkers(body)).toEqual([
            { kind: "resolution", attempt: ATTEMPT, finding: "f3", state: "fixed" },
        ]);
    });

    it("a review body holds three lines, then the review marker", () => {
        const body = reviewBody({
            attempt: ATTEMPT,
            stage: "code-review",
            round: 1,
            states: ["open", "resolved", "resolved", "open", "open"],
            review: { tier: "M", skipped: [{ reviewer: "coderabbit", reason: "rate limited" }] },
        });
        expect(body).toBe(
            [
                "Code review, round 1",
                "Threads: 3 open, 2 resolved",
                "Review team: tier M, skipped coderabbit (rate limited)",
                `<!-- autonomous:review v1 attempt=${ATTEMPT} round=1 -->`,
            ].join("\n"),
        );
    });

    it("a review body holds the comments no thread can hold before its marker", () => {
        const comment = first(doubt());
        const body = reviewBody({
            attempt: ATTEMPT,
            stage: "code-review",
            round: 2,
            states: [],
            review: { tier: "S", skipped: [] },
            unanchored: [comment],
        });
        expect(body.split("\n").slice(0, 3)).toEqual([
            "Code review, round 2",
            "Threads: 0 open, 0 resolved",
            "Review team: tier S, none skipped",
        ]);
        expect(body).toContain(`\n\n${comment}\n`);
        expect(parseMarkers(body).at(-1)).toEqual({ kind: "review", attempt: ATTEMPT, round: 2 });
    });
});

describe("titles for the exact-match backstop", () => {
    it("reads the title of a stage's first comment, and nothing from another comment", () => {
        expect(titleOf(first(CRITICAL))).toBe(
            "The retry loop never stops when the token is revoked.",
        );
        expect(titleOf(first(doubt()))).toBe("Should a revoked token be retried at all?");
        expect(titleOf("Looks good to me")).toBeNull();
    });

    it("compares titles ignoring case and whitespace", () => {
        expect(normalisedTitle("  The Retry\tloop ")).toBe("theretryloop");
        expect(sameTitle("The retry loop", "the  RETRY loop")).toBe(true);
        expect(sameTitle("The retry loop", "The retry loops")).toBe(false);
    });
});
