import { describe, expect, it } from "vitest";

import { publicationOf } from "./outcome.ts";
import { doubt, finding } from "./test-fixtures.ts";

describe("Only surviving findings are published", () => {
    it("Refuted finding: a WARNING refuted for lack of a reproduction is not published", () => {
        const entry = finding({
            refutation: { outcome: "refuted", reproduction: null },
            publication: { state: "none" },
        });
        expect(publicationOf(entry)).toBeNull();
    });

    it("Fixed suggestion: a fixed SUGGESTION is not published", () => {
        expect(publicationOf(finding({ severity: "SUGGESTION", label: "suggestion" }))).toBeNull();
    });

    it("does not publish a dismissed finding", () => {
        const entry = finding({
            destination: "dismiss",
            refutation: { outcome: "not-refuted", reproduction: null },
            publication: { state: "none" },
        });
        expect(publicationOf(entry)).toBeNull();
    });

    it("publishes a doubt only when the record marks it for publication", () => {
        expect(publicationOf(doubt({ destination: "settled" }))).toBeNull();
        expect(
            publicationOf(doubt({ destination: "ask", publication: { state: "asked" } })),
        ).toBeNull();
        expect(publicationOf(doubt())).not.toBeNull();
    });
});

describe("A thread's state follows the finding's outcome", () => {
    it("Fixed warning: resolved, its status line names the commit", () => {
        expect(publicationOf(finding())).toEqual({
            state: "resolved",
            status: "fixed in abc1234",
            label: "issue",
            blocking: false,
            publication: "fixed",
        });
    });

    it("Follow-up only proposed: open", () => {
        const entry = finding({
            destination: "defer",
            publication: { state: "deferred", proposedTitle: "Stop retrying revoked tokens" },
        });
        expect(publicationOf(entry)).toMatchObject({
            state: "open",
            status: 'deferred: follow-up proposed, "Stop retrying revoked tokens"',
        });
    });

    it("Created follow-up: resolved, its status line holds the URL", () => {
        const url = "https://linear.app/monolab/issue/DOT-170";
        const entry = finding({
            destination: "defer",
            publication: { state: "deferred", followUp: url },
        });
        expect(publicationOf(entry)).toMatchObject({
            state: "resolved",
            status: `deferred to ${url}`,
        });
    });

    it("keeps a blocked finding open", () => {
        const entry = finding({ publication: { state: "blocked", reason: "the API is frozen" } });
        expect(publicationOf(entry)).toMatchObject({
            state: "open",
            status: "blocked: the API is frozen",
        });
    });

    it("keeps a doubt open, as a blocking question", () => {
        expect(publicationOf(doubt())).toEqual({
            state: "open",
            status: "open question",
            label: "question",
            blocking: true,
            publication: "none",
        });
    });

    it("marks a CRITICAL finding blocking and a suggestion by its label", () => {
        expect(publicationOf(finding({ severity: "CRITICAL" }))).toMatchObject({ blocking: true });
        const deferred = finding({
            severity: "SUGGESTION",
            label: "suggestion",
            destination: "defer",
            publication: { state: "deferred", proposedTitle: "Rename it" },
        });
        expect(publicationOf(deferred)).toMatchObject({ label: "suggestion", blocking: false });
    });
});

describe("A finding passed on is addressed to its stage", () => {
    it("Passed on to QA: open, shows #qa and is addressed to qa", () => {
        const entry = finding({
            destination: "pass-on",
            refutation: { outcome: "not-refuted", reproduction: null },
            publication: { state: "passed-on", stage: "qa" },
        });
        expect(publicationOf(entry)).toEqual({
            state: "open",
            status: "passed on to QA #qa",
            label: "issue",
            blocking: false,
            publication: "passed-on",
            for: "qa",
        });
    });
});
