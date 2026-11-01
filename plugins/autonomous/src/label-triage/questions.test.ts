import { describe, expect, it } from "vitest";

import { type DecidedGroup, MEANINGS } from "../label-contract/contract.ts";
import { detect } from "../label-contract/detect.ts";
import { questionsFor } from "./questions.ts";
import { labelTriageStep } from "./step.ts";
import { config, task, trackers, triageContext } from "./test-fixtures.ts";
import type { TrackerTask } from "./trackers/tracker.ts";
import type { TriageRecord, WriteFailure } from "./write.ts";

function asked(
    listed: TrackerTask,
    group: DecidedGroup,
    overrides: Partial<TriageRecord> = {},
): TriageRecord {
    return {
        source: listed.source,
        taskId: listed.id,
        title: listed.title,
        group,
        labels: group === "scope" ? ["work"] : ["HITL"],
        confidence: 0.8,
        reason: "Needs review",
        tier: "llm",
        status: "asked",
        detail: "below threshold 0.95: 0.80",
        ...overrides,
    };
}

const LATER = { label: "Later", value: null, description: "Leave it for a later run" };

// The questions for one asked autonomy group of each task, in the order given.
function questionsOf(listed: TrackerTask[], descriptions = new Map<string, string>()) {
    const rules = config().sources;
    return questionsFor(
        listed.map((t) => asked(t, "autonomy")),
        [],
        listed.map((t) => detect(t, rules[t.source])),
        descriptions,
    );
}

function descriptionLine(description: string | null): string | undefined {
    const [question] = questionsOf([task("beads", "B-1", ["work"], { description })]);
    return question?.question.split("\n")[2];
}

describe("label triage questions: selection and order", () => {
    it("asks only asked records, a task's scope before its autonomy whatever order they arrive in", () => {
        const listed = task("github", "owner/repo#2", []);
        const questions = questionsFor(
            [
                asked(listed, "autonomy"),
                asked(listed, "scope"),
                asked(listed, "autonomy", { status: "proposed", detail: null }),
            ],
            [],
            [detect(listed, config().sources.github)],
            new Map(),
        );
        expect(questions.map((q) => q.id)).toEqual([
            "label-triage:github:owner/repo#2:scope",
            "label-triage:github:owner/repo#2:autonomy",
        ]);
    });

    it("heads a question with a 12-character task id, and with the group for a 13-character one", () => {
        const questions = questionsOf([
            task("github", "owner/repo#2", ["work"]),
            task("github", "owner/repo#12", ["work"]),
        ]);
        expect(questions.map((q) => [q.id, q.header])).toEqual([
            ["label-triage:github:owner/repo#12:autonomy", "autonomy"],
            ["label-triage:github:owner/repo#2:autonomy", "owner/repo#2"],
        ]);
    });

    it("renders a record without labels as no label", () => {
        const listed = task("beads", "B-1", ["work"]);
        const [question] = questionsFor(
            [
                asked(listed, "autonomy", {
                    labels: [],
                    detail: "invalid under the contract: no label",
                }),
            ],
            [],
            [detect(listed, config().sources.beads)],
            new Map(),
        );
        expect(question?.question.split("\n")[1]).toBe(
            "Seen: labels [work] → no label (llm, 0.80) → invalid under the contract: no label — Needs review",
        );
        expect(question?.options.map((o) => o.description.startsWith("judged"))).toEqual([
            false,
            false,
            false,
            false,
        ]);
    });
});

describe("label triage questions: what the run saw", () => {
    it("adds the labels this run wrote to the same task, and only those", () => {
        const listed = task("beads", "B-1", ["nazaries"]);
        const other = task("beads", "B-2", []);
        const [question] = questionsFor(
            [
                asked(listed, "scope", { status: "applied", detail: null, labels: ["work"] }),
                asked(other, "scope", { status: "applied", detail: null, labels: ["personal"] }),
                asked(listed, "autonomy", { status: "proposed", detail: null, labels: ["AFK"] }),
                asked(listed, "autonomy"),
            ],
            [],
            [detect(listed, config().sources.beads), detect(other, config().sources.beads)],
            new Map(),
        );
        expect(question?.question.split("\n")[1]).toBe(
            "Seen: labels [nazaries] + written [work] → HITL (llm, 0.80) → below threshold 0.95: 0.80 — Needs review",
        );
    });

    it("shows no confidence for a rule's record", () => {
        const listed = task("beads", "B-1", ["nazaries", "personal"]);
        const [question] = questionsFor(
            [
                asked(listed, "scope", {
                    labels: ["work", "personal"],
                    confidence: 0,
                    tier: "code",
                    detail: "invalid under the contract: two scope labels: work, personal",
                    reason: "conflicting evidence",
                }),
            ],
            [],
            [detect(listed, config().sources.beads)],
            new Map(),
        );
        expect(question?.question.split("\n")[1]).toBe(
            "Seen: labels [nazaries, personal] → work, personal (code) → invalid under the contract: two scope labels: work, personal — conflicting evidence",
        );
    });
});

describe("label triage questions: the description excerpt", () => {
    it("collapses every run of whitespace to one space and trims it", () => {
        expect(descriptionLine("  Line one\n\n\tline   two  \n")).toBe(
            "Description: Line one line two",
        );
    });

    it("keeps 300 characters whole and cuts a longer description with an ellipsis", () => {
        expect(descriptionLine("a".repeat(300))).toBe(`Description: ${"a".repeat(300)}`);
        expect(descriptionLine(`${"a".repeat(300)}bcd`)).toBe(`Description: ${"a".repeat(300)}…`);
    });

    it("counts whitespace after collapsing it and characters by code point", () => {
        expect(descriptionLine(`a${" ".repeat(10)}${"b".repeat(298)}c`)).toBe(
            `Description: a ${"b".repeat(298)}…`,
        );
        expect(descriptionLine(`${"a".repeat(299)}😀b`)).toBe(`Description: ${"a".repeat(299)}😀…`);
    });

    it("leaves the line out when no description was read or it is only whitespace", () => {
        expect(descriptionLine(null)).toBeUndefined();
        expect(descriptionLine(" \n\t ")).toBeUndefined();
    });

    it("uses the description read while judging when the listing carries none", () => {
        const [question] = questionsOf(
            [task("linear", "DOT-2", [])],
            new Map([["linear:DOT-2", "Refine\nthe plan"]]),
        );
        expect(question?.question.split("\n")[2]).toBe("Description: Refine the plan");
    });
});

describe("label triage questions: Questions for the human", () => {
    it("Judgement below the threshold: offers AFK, HITL, grill-me and Later, HITL prefixed with its judgement", () => {
        const listed = task("beads", "X-12", ["work"]);
        const [question] = questionsFor(
            [asked(listed, "autonomy")],
            [],
            [detect(listed, config().sources.beads)],
            new Map(),
        );
        expect(question?.options).toEqual([
            { label: "AFK", value: "AFK", description: MEANINGS.AFK },
            {
                label: "HITL",
                value: "HITL",
                description: `judged 0.80 · Needs review — ${MEANINGS.HITL}`,
            },
            { label: "grill-me", value: "grill-me", description: MEANINGS["grill-me"] },
            LATER,
        ]);
        expect(question?.options[1]?.description).toMatch(/^judged 0\.80 · Needs review/);
        expect(question?.multiSelect).toBe(false);
    });

    it("Task already in proposal: offers AFK, HITL and Later, and no grill-me", () => {
        const listed = task("beads", "X-12", ["work", "proposal"]);
        const [question] = questionsFor(
            [asked(listed, "autonomy")],
            [],
            [detect(listed, config().sources.beads)],
            new Map(),
        );
        expect(question?.options.map((option) => option.label)).toEqual(["AFK", "HITL", "Later"]);
    });

    it("Task already in proposal: an asked grill-me judgement offers no grill-me either", () => {
        const listed = task("linear", "DOT-90", ["personal", "proposal"]);
        const [question] = questionsFor(
            [
                asked(listed, "autonomy", {
                    labels: ["grill-me"],
                    confidence: 0.99,
                    reason: "Unclear",
                    detail: "invalid under the contract: grill-me with a stage label: proposal",
                }),
            ],
            [],
            [detect(listed, config().sources.linear)],
            new Map(),
        );
        expect(question?.question.split("\n")[1]).toBe(
            "Seen: labels [personal, proposal] → grill-me (llm, 0.99) → invalid under the contract: " +
                "grill-me with a stage label: proposal — Unclear",
        );
        expect(question?.options).toEqual([
            { label: "AFK", value: "AFK", description: MEANINGS.AFK },
            { label: "HITL", value: "HITL", description: MEANINGS.HITL },
            LATER,
        ]);
    });

    it("Scope with conflicting evidence: offers work, personal and Later, showing both pieces of evidence", () => {
        const rules = { ...config().sources.beads, scope: "personal" as const };
        const listed = task("beads", "X-12", ["nazaries"]);
        const [question] = questionsFor(
            [
                asked(listed, "scope", {
                    labels: ["work", "personal"],
                    confidence: 0,
                    tier: "code",
                    reason: "conflicting evidence: alias nazaries; every beads task is personal",
                    detail: "invalid under the contract: two scope labels: work, personal",
                }),
            ],
            [],
            [detect(listed, rules)],
            new Map(),
        );
        expect(question?.question.split("\n")[1]).toBe(
            "Seen: labels [nazaries] → work, personal (code) → invalid under the contract: two scope labels: " +
                "work, personal — conflicting evidence: alias nazaries; every beads task is personal",
        );
        expect(question?.options).toEqual([
            { label: "work", value: "work", description: MEANINGS.work },
            { label: "personal", value: "personal", description: MEANINGS.personal },
            LATER,
        ]);
    });

    it("Scope written in the same run: the autonomy question shows nazaries plus work written by this run", () => {
        const listed = task("beads", "X-12", ["nazaries"]);
        const [question] = questionsFor(
            [
                asked(listed, "scope", { status: "applied", detail: null, tier: "code" }),
                asked(listed, "autonomy"),
            ],
            [],
            [detect(listed, config().sources.beads)],
            new Map(),
        );
        expect(question?.id).toBe("label-triage:beads:X-12:autonomy");
        expect(question?.question.split("\n")[1]).toBe(
            "Seen: labels [nazaries] + written [work] → HITL (llm, 0.80) → below threshold 0.95: 0.80 — Needs review",
        );
    });

    it("Present labels in conflict: listed for the human, with no question", async () => {
        const result = await labelTriageStep.run(
            triageContext({
                trackers: trackers([], {
                    beads: [task("beads", "B-3", ["work", "personal", "AFK", "proposal"])],
                }),
                args: { apply: true },
            }),
        );
        expect(result.data.conflicts.map((c) => [c.taskId, c.group])).toEqual([["B-3", "scope"]]);
        expect(result.questions).toEqual([]);
    });

    it("Source whose writes stopped: no question for any Linear task", () => {
        const linear = [task("linear", "DOT-1", []), task("linear", "DOT-2", [])];
        const beads = task("beads", "X-12", ["work"]);
        const failure: WriteFailure = {
            source: "linear",
            taskId: "DOT-1",
            labels: ["personal"],
            before: [],
            after: [],
            error: "read-back mismatch: before [] + [personal] → after []",
        };
        const rules = config().sources;
        const questions = questionsFor(
            [...linear, beads].map((t) => asked(t, "autonomy")),
            [failure],
            [...linear, beads].map((t) => detect(t, rules[t.source])),
            new Map(),
        );
        expect(questions.map((q) => q.id)).toEqual(["label-triage:beads:X-12:autonomy"]);
    });

    it("Order: the task with work evidence updated yesterday comes before a personal task updated today", () => {
        const questions = questionsOf([
            task("beads", "P-1", ["personal"], { updatedAt: "2026-09-23T09:00:00Z" }),
            task("beads", "W-1", ["nazaries"], { updatedAt: "2026-09-22T09:00:00Z" }),
        ]);
        expect(questions.map((q) => q.id)).toEqual([
            "label-triage:beads:W-1:autonomy",
            "label-triage:beads:P-1:autonomy",
        ]);
    });

    it("Header: DOT-104 for the Linear task and the asked group for agentic-task-8v0", () => {
        const questions = questionsOf([
            task("linear", "DOT-104", []),
            task("beads", "agentic-task-8v0", ["work"]),
        ]);
        expect(questions.map((q) => [q.id, q.header])).toEqual([
            ["label-triage:beads:agentic-task-8v0:autonomy", "autonomy"],
            ["label-triage:linear:DOT-104:autonomy", "DOT-104"],
        ]);
    });
});
