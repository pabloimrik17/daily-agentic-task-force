import { readFileSync } from "node:fs";

import { beforeAll, describe, expect, it } from "vitest";

import { ADVERSARIAL_REVIEW_SKILL, loadPluginSkill } from "./plugin-skill.ts";

// The adversarial-review scenarios the skill's text decides. SKILL.md is hard-wrapped, so
// compare with whitespace collapsed.
const SKILL_FILE = new URL("../../skills/adversarial-review/SKILL.md", import.meta.url);

function collapse(text: string): string {
    return text.replace(/\s+/g, " ");
}

let body: string;

beforeAll(async () => {
    const loaded = await loadPluginSkill(ADVERSARIAL_REVIEW_SKILL);
    if (!loaded.ok) {
        throw new Error(loaded.error);
    }
    body = collapse(loaded.value);
});

function description(): string {
    const line = readFileSync(SKILL_FILE, "utf8")
        .split("\n")
        .find((entry) => entry.startsWith("description: "));
    return line?.slice("description: ".length) ?? "";
}

describe("the adversarial review skill", () => {
    it("General review request: the description claims only a request that names an adversarial review", () => {
        expect(description()).toContain("Use only when a request names an adversarial review");
        expect(description()).toContain(
            "Never use it for a request to review a pull request, change or code that does not name an adversarial review",
        );
    });

    it("takes every parameter from its caller and never guesses the floor", () => {
        for (const parameter of [
            "the subject of the review",
            "the references it is checked against",
            "the procedure of the report",
            "the scale of severities and its floor",
            "the later reviews a finding can be passed on to",
            "where the record of the findings is kept",
            "whether a human follows the review",
        ]) {
            expect(body).toContain(parameter);
        }
        expect(body).toContain("before the report starts. Never guess the floor.");
    });

    it("holds no fact about a particular stage", () => {
        for (const fact of ["verify", "CRITICAL", "OpenSpec"]) {
            expect(body.toLowerCase()).not.toContain(fact.toLowerCase());
        }
    });

    it("runs the phases in order", () => {
        expect(body).toContain(
            "Run the phases in this order: the report, the finding triage, the refutation, the fix and the fix check.",
        );
    });

    it("One round: no second report follows the fixes", () => {
        expect(body).toContain("A round runs each phase once: no second report follows the fixes");
    });

    it("Fixer and checker: a fix is judged by teammates other than its fixer", () => {
        expect(body).toContain("A fix is judged by teammates other than its fixer.");
        expect(body).toContain("Teammates other than the fixer judge each fix.");
    });

    it("starts each phase's teammates fresh, keeps the reporter reading, and lets only the orchestrator commit", () => {
        expect(body).toContain("Start each phase's teammates fresh.");
        expect(body).toContain("The reporter only reads.");
        expect(body).toContain("A finding is refuted by teammates other than its reporter.");
        expect(body).toContain("You are the only one that commits.");
    });

    it("Effort left free: the orchestrator chooses every teammate's model and effort and how many teammates", () => {
        expect(body).toContain(
            "You choose how many teammates each phase takes, and the model and effort of every teammate",
        );
        expect(body).toContain("choose the reporter's from the complexity of the subject");
        expect(body).not.toMatch(/\b(?:\d+|one|two|three|four|five) teammates?\b/i);
    });

    it("Finding reported: each finding carries its severity and evidence, and the reporter changes no file", () => {
        expect(body).toContain("reports each finding with its severity, on the caller's scale");
        expect(body).toContain("its evidence: a file and line, or an artifact section");
        expect(body).toContain("It changes no file of the subject.");
    });

    it("Duplicates merged: a merged finding names the reported findings it comes from", () => {
        expect(body).toContain("Merge findings that share one root cause");
        expect(body).toContain("split a finding that mixes concerns");
        expect(body).toContain("names the reported findings it comes from");
    });

    it("sends each finding, with its reason, to fix, pass on, defer or dismiss", () => {
        expect(body).toContain(
            "Send each finding, with its reason, to one destination: fix it now, pass it on to a later review the caller named, defer it to a follow-up task, or dismiss it.",
        );
    });

    it("Plainly false finding: may be dismissed below the floor without a refutation", () => {
        expect(body).toContain(
            "You may dismiss a finding below the floor that the subject plainly contradicts, with its reason, without a refutation.",
        );
    });

    it("Severity kept: the finding triage never changes a finding's severity", () => {
        expect(body).toContain("Never change a finding's severity, even when you judge it lower.");
    });

    it("Critical finding: a finding at or above the floor goes only to fix", () => {
        expect(body).toContain("Send a finding at or above the floor only to fix.");
        expect(body).toContain(
            "It leaves the review unfixed only when the refutation shows it does not hold.",
        );
    });

    it("Passed on whatever its severity: the caller may name findings that go to a later review", () => {
        expect(body).toContain(
            "Your caller may name the findings that go to a later review whatever their severity.",
        );
        expect(body).toContain(
            "such a finding goes to that later review, and the floor holds for every other finding.",
        );
    });

    it("Human present: the human sees the finding triage before any refutation starts", () => {
        expect(body).toContain(
            "show them the finding triage, each finding with its destination and reason, before any refutation starts, and apply their changes",
        );
        expect(body).toContain("write each decision and its reason in the record as an assumption");
    });

    it("refutes only the findings sent to fix or to defer", () => {
        expect(body).toContain("try to refute each finding sent to fix or to defer");
        expect(body).toContain("Never refute a finding passed on or dismissed.");
    });

    it("Behaviour a test can show: survives only with a test that fails because of it", () => {
        expect(body).toContain(
            "A finding survives only with its reproduction: a test that fails because of it, when a test can show it; otherwise, the exact text it contradicts or misses, beside the place that does so.",
        );
    });

    it("Refuted: the finding does not survive, and the record says why", () => {
        expect(body).toContain("A finding with no reproduction does not survive.");
        expect(body).toContain("Write in the record why it does not hold.");
    });

    it("Unfixed reproduction test removed: a refuted or deferred finding's test never reaches a commit", () => {
        expect(body).toContain(
            "A reproduction test of a finding left unfixed, because it was refuted or deferred, never reaches a commit: once the record holds its path and its text, remove it from the working tree.",
        );
    });

    it("Reproduction test kept: the fix leaves the test unchanged and it is committed with the fix", () => {
        expect(body).toContain("It never changes the finding's reproduction test");
        expect(body).toContain(
            "the test stays with the fix as a regression test and is committed with it",
        );
    });

    it("Accepted fix: accepted only when the reproduction test fails without it and passes with it, and it does no more than asked", () => {
        expect(body).toContain("its reproduction no longer holds;");
        expect(body).toContain("fails without the fix and passes with it;");
        expect(body).toContain("the fix does no more than its finding asks.");
        expect(body).toContain("Commit each accepted fix.");
    });

    it("Fixes one at a time: each fix check judges a tree that holds no other fix", () => {
        expect(body).toContain(
            "Run the fixes one at a time: a fix, its fix checks and the commit of an accepted fix end before the next fixer starts, so each fix check judges a tree that holds no other fix.",
        );
    });

    it("Rejected twice: blocks the review with no human, naming the finding and the rejections", () => {
        expect(body).toContain(
            "send a fix rejected by its first fix check back to the fix with the reasons",
        );
        expect(body).toContain(
            "A fix rejected by its second fix check blocks the review when no human follows it, and goes to the human otherwise; either way, name the finding and the rejections.",
        );
    });

    it("Deferred finding survives: the record proposes a follow-up task, whose creation is the caller's", () => {
        expect(body).toContain(
            "A deferred finding that survives the refutation becomes a proposed follow-up task in the record, with a title, its reason, the finding it comes from and its reproduction.",
        );
        expect(body).toContain(
            "Whether a follow-up task is created, and where, is the caller's to decide.",
        );
    });

    it("Record complete: every reported finding with its destination, and every fixed one with its commit", () => {
        expect(body).toContain("Keep the record where the caller says.");
        expect(body).toContain(
            "every reported finding with its severity, its destination and reason, the refutation's outcome and its reproduction, and, for a fixed one, the fix's commit and its fix check verdicts",
        );
        expect(body).toContain(
            "Build what the caller writes for a person or the next agent from the record.",
        );
    });
});
