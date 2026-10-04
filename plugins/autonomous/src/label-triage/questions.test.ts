import { describe, expect, it } from "vitest";

import type { Group } from "../label-contract/contract.ts";
import { detect } from "../label-contract/detect.ts";
import { questionsFor } from "./questions.ts";
import { config, task } from "./test-fixtures.ts";
import type { TrackerTask } from "./trackers/tracker.ts";
import type { TriageRecord } from "./write.ts";

function asked(
    listed: TrackerTask,
    group: Group,
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

// The questions for one asked entry group of each task, in the order given.
function questionsOf(listed: TrackerTask[], descriptions = new Map<string, string>()) {
    const rules = config().sources;
    return questionsFor(
        listed.map((t) => asked(t, "entry")),
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
    it("asks only asked records, a task's scope before its entry whatever order they arrive in", () => {
        const listed = task("github", "owner/repo#2", []);
        const questions = questionsFor(
            [
                asked(listed, "entry"),
                asked(listed, "scope"),
                asked(listed, "entry", { status: "proposed", detail: null }),
            ],
            [],
            [detect(listed, config().sources.github)],
            new Map(),
        );
        expect(questions.map((q) => q.id)).toEqual([
            "label-triage:github:owner/repo#2:scope",
            "label-triage:github:owner/repo#2:entry",
        ]);
    });

    it("heads a question with a 12-character task id, and with the group for a 13-character one", () => {
        const questions = questionsOf([
            task("github", "owner/repo#2", ["work"]),
            task("github", "owner/repo#12", ["work"]),
        ]);
        expect(questions.map((q) => [q.id, q.header])).toEqual([
            ["label-triage:github:owner/repo#12:entry", "entry"],
            ["label-triage:github:owner/repo#2:entry", "owner/repo#2"],
        ]);
    });

    it("renders a record without labels as no label", () => {
        const listed = task("beads", "B-1", ["work"]);
        const [question] = questionsFor(
            [
                asked(listed, "entry", {
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
                asked(listed, "entry", { status: "proposed", detail: null, labels: ["AFK"] }),
                asked(listed, "entry"),
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
