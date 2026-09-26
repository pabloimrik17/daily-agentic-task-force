import { describe, expect, it } from "vitest";

import type { StepResult } from "../runner.ts";
import type { JudgementAnswer } from "./judgement.ts";
import type { Derivation } from "./rules.ts";
import { type LabelTriageData, labelTriageStep } from "./step.ts";
import { triageContext, fakeJudgement, task, trackers } from "./test-fixtures.ts";
import type { TriageRecord } from "./write.ts";

function record(
    overrides: Partial<Derivation>,
    status: TriageRecord["status"],
    detail: string | null = null,
): TriageRecord {
    return {
        source: "beads",
        taskId: "X-12",
        title: "A task",
        group: "scope",
        labels: ["work"],
        confidence: 1,
        reason: "alias nazaries",
        tier: "code",
        ...overrides,
        status,
        detail,
    };
}

const counts = (source: "beads" | "linear", read: number) => ({
    source,
    read,
    complete: 1,
    missing: { scope: 1, entry: 2 },
    conflict: { scope: 0, entry: 1 },
});

describe("renderLabelTriage", () => {
    it("shows counts, applied and proposed labels, the human's share, the remainder and failures", () => {
        const llm = { source: "linear", taskId: "DOT-82", group: "entry", tier: "llm" } as const;
        const result: StepResult<LabelTriageData> = {
            step: "label-triage",
            tier: "llm",
            outcome: "advance",
            reasons: ["beads: 4 read, 1 complete, 1 missing scope, 2 missing entry, 1 in conflict"],
            data: {
                sources: [counts("beads", 4), counts("linear", 12)],
                records: [
                    record({}, "applied"),
                    record(
                        { ...llm, labels: ["AFK"], confidence: 0.97, reason: "a clear agent task" },
                        "applied",
                    ),
                    record(
                        { ...llm, taskId: "DOT-9", labels: ["personal"], group: "scope" },
                        "failed",
                        "read-back mismatch",
                    ),
                    record(
                        {
                            ...llm,
                            taskId: "DOT-10",
                            labels: ["HITL"],
                            confidence: 0.99,
                            reason: "a review task",
                        },
                        "proposed",
                        "skipped after a write failure on linear",
                    ),
                    record(
                        {
                            ...llm,
                            taskId: "DOT-5",
                            labels: ["HITL"],
                            confidence: 0.8,
                            reason: "needs a review",
                        },
                        "asked",
                        "below threshold 0.95: 0.80",
                    ),
                ],
                conflicts: [
                    {
                        source: "beads",
                        taskId: "X-1",
                        title: "A task",
                        group: "entry",
                        labels: ["AFK", "HITL"],
                    },
                ],
                notJudged: [
                    { source: "beads", taskId: "X-2", reason: "missing from the judgement" },
                    { source: "linear", taskId: "DOT-7", reason: "claude timed out after 300 s" },
                ],
                remainder: 35,
                judgement: { model: "claude-sonnet-5", effort: "medium", cap: 25, batches: 2 },
                failures: [
                    {
                        source: "linear",
                        taskId: "DOT-9",
                        labels: ["personal"],
                        before: ["a", "b"],
                        after: ["a"],
                        error: "read-back mismatch",
                    },
                    {
                        source: "linear",
                        taskId: "DOT-11",
                        labels: ["AFK"],
                        before: [],
                        after: null,
                        error: "linear issue update DOT-11: linear timed out after 120 s",
                    },
                ],
            },
        };
        expect(labelTriageStep.render(result)).toBe(
            [
                "[label-triage] advance (llm)",
                "  beads     read 4    complete 1  missing scope 1 / entry 2  conflict scope 0 / entry 1",
                "  linear    read 12   complete 1  missing scope 1 / entry 2  conflict scope 0 / entry 1",
                "  applied:",
                "    beads → X-12 → work → alias nazaries (code, 1.00)",
                "    linear → DOT-82 → AFK → a clear agent task (llm, 0.97)",
                "  proposed:",
                "    linear → DOT-10 → HITL → a review task (llm, 0.99) — skipped after a write failure on linear",
                "  for the human:",
                "    beads → X-1 → entry: AFK, HITL seen → conflict",
                "    linear → DOT-5 → entry: HITL (llm, 0.80) → below threshold 0.95: 0.80 — needs a review",
                "  not judged: 2 tasks",
                "    beads → X-2 → missing from the judgement",
                "    linear → DOT-7 → claude timed out after 300 s",
                "  remainder: 35 tasks beyond the cap of 25",
                "  write failures:",
                "    linear → DOT-9 → personal → before [a, b] → after [a]",
                "    linear → DOT-11 → AFK → before [] → linear issue update DOT-11: linear timed out after 120 s",
                "  judgement: claude-sonnet-5 (medium), 2 batches",
                "  reasons:",
                "    - beads: 4 read, 1 complete, 1 missing scope, 2 missing entry, 1 in conflict",
            ].join("\n"),
        );
    });

    it("shows only the header and the reason when the step is not evaluable", async () => {
        const result = await labelTriageStep.run(
            triageContext({
                trackers: trackers([], { beads: "bd list --json: bd CLI not found on PATH" }),
            }),
        );
        expect(labelTriageStep.render(result)).toBe(
            [
                "[label-triage] not-evaluable (code)",
                "  reasons:",
                "    - beads: bd list --json: bd CLI not found on PATH",
            ].join("\n"),
        );
    });

    it("carries every derived group in the JSON data with its status, confidence and reason", async () => {
        const judgement = fakeJudgement((request) => ({
            ok: true,
            answers: request.tasks.map((t): JudgementAnswer => {
                if (t.id === "owner/repo#2") {
                    return {
                        id: t.id,
                        scope: { labels: ["work"], confidence: 0.6, reason: "maybe work" },
                        entry: { labels: ["AFK"], confidence: 0.97, reason: "clear" },
                    };
                }
                return {
                    id: t.id,
                    entry: { labels: ["HITL"], confidence: 0.96, reason: "review" },
                };
            }),
        }));
        const result = await labelTriageStep.run(
            triageContext({
                trackers: trackers(
                    [],
                    {
                        beads: [task("beads", "X-12", ["nazaries"])],
                        github: [task("github", "owner/repo#2", [])],
                        linear: [task("linear", "DOT-3", [])],
                    },
                    { linear: { addLabelError: "linear issue update DOT-3: failed" } },
                ),
                judgement,
                args: { apply: true, json: true },
            }),
        );
        const data = JSON.parse(JSON.stringify(result.data)) as LabelTriageData;
        const groups = data.records.map((r) => ({
            key: `${r.source} ${r.taskId} ${r.group}`,
            status: r.status,
            confidence: r.confidence,
            reason: r.reason,
            tier: r.tier,
        }));
        expect(groups).toEqual([
            {
                key: "beads X-12 scope",
                status: "applied",
                confidence: 1,
                reason: "alias nazaries",
                tier: "code",
            },
            {
                key: "beads X-12 entry",
                status: "applied",
                confidence: 0.96,
                reason: "review",
                tier: "llm",
            },
            {
                key: "github owner/repo#2 entry",
                status: "applied",
                confidence: 0.97,
                reason: "clear",
                tier: "llm",
            },
            {
                key: "linear DOT-3 scope",
                status: "failed",
                confidence: 1,
                reason: "every linear task is personal",
                tier: "code",
            },
            {
                key: "linear DOT-3 entry",
                status: "proposed",
                confidence: 0.96,
                reason: "review",
                tier: "llm",
            },
            {
                key: "github owner/repo#2 scope",
                status: "asked",
                confidence: 0.6,
                reason: "maybe work",
                tier: "llm",
            },
        ]);
        expect(data.records.every((r) => r.title !== "" && r.labels.length > 0)).toBe(true);
    });
});
