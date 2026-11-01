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
    missing: { scope: 1, autonomy: 2, stage: 3 },
    conflict: { scope: 0, autonomy: 1, stage: 1 },
});

describe("renderLabelTriage", () => {
    it("shows counts, applied and proposed labels, the human's share, the remainder and failures", () => {
        const llm = { source: "linear", taskId: "DOT-82", group: "autonomy", tier: "llm" } as const;
        const result: StepResult<LabelTriageData> = {
            step: "label-triage",
            tier: "llm",
            outcome: "advance",
            reasons: [
                "beads: 4 read, 1 complete, 1 missing scope, 2 missing autonomy, 3 missing stage, 2 in conflict",
                "proposal is missing on linear; run --bootstrap-labels",
            ],
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
                            group: "stage",
                            labels: ["proposal"],
                            reason: "follows autonomy AFK",
                        },
                        "applied",
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
                            source: "linear",
                            taskId: "DOT-12",
                            group: "stage",
                            labels: ["proposal"],
                            reason: "autonomy HITL is present",
                        },
                        "proposed",
                        "proposal is missing on linear; run --bootstrap-labels",
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
                        group: "autonomy",
                        labels: ["AFK", "HITL"],
                    },
                    {
                        source: "beads",
                        taskId: "X-4",
                        title: "A task",
                        group: "stage",
                        labels: ["grill-me", "proposal"],
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
                        source: "beads",
                        taskId: "X-3",
                        labels: ["HITL", "AFK"],
                        before: ["nazaries"],
                        after: ["nazaries", "HITL"],
                        error: "bd label add: bd failed: boom",
                    },
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
                "  beads     read 4    complete 1  missing scope 1 / autonomy 2 / stage 3  conflict scope 0 / autonomy 1 / stage 1",
                "  linear    read 12   complete 1  missing scope 1 / autonomy 2 / stage 3  conflict scope 0 / autonomy 1 / stage 1",
                "  applied:",
                "    beads → X-12 → work → alias nazaries (code, 1.00)",
                "    linear → DOT-82 → AFK → a clear agent task (llm, 0.97)",
                "    beads → X-12 → proposal → follows autonomy AFK (code, 1.00)",
                "  proposed:",
                "    linear → DOT-10 → HITL → a review task (llm, 0.99) — skipped after a write failure on linear",
                "    linear → DOT-12 → proposal → autonomy HITL is present (code, 1.00) — proposal is missing on linear; run --bootstrap-labels",
                "  for the human:",
                "    beads → X-1 → autonomy: AFK, HITL seen → conflict",
                "    beads → X-4 → stage: grill-me, proposal seen → conflict",
                "    linear → DOT-5 → autonomy: HITL (llm, 0.80) → below threshold 0.95: 0.80 — needs a review",
                "  not judged: 2 tasks",
                "    beads → X-2 → missing from the judgement",
                "    linear → DOT-7 → claude timed out after 300 s",
                "  remainder: 35 tasks beyond the cap of 25",
                "  write failures:",
                "    beads → X-3 → HITL, AFK → before [nazaries] → after [nazaries, HITL] → bd label add: bd failed: boom",
                "    linear → DOT-9 → personal → before [a, b] → after [a]",
                "    linear → DOT-11 → AFK → before [] → linear issue update DOT-11: linear timed out after 120 s",
                "  judgement: claude-sonnet-5 (medium), 2 batches",
                "  reasons:",
                "    - beads: 4 read, 1 complete, 1 missing scope, 2 missing autonomy, 3 missing stage, 2 in conflict",
                "    - proposal is missing on linear; run --bootstrap-labels",
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

    it("carries every derived group in the JSON data with its status, confidence and reason, keyed without entry", async () => {
        const judgement = fakeJudgement((request) => ({
            ok: true,
            answers: request.tasks.map((t): JudgementAnswer => {
                if (t.id === "owner/repo#2") {
                    return {
                        id: t.id,
                        scope: { labels: ["work"], confidence: 0.6, reason: "maybe work" },
                        autonomy: { labels: ["AFK"], confidence: 0.97, reason: "clear" },
                    };
                }
                return {
                    id: t.id,
                    autonomy: { labels: ["HITL"], confidence: 0.96, reason: "review" },
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
        const code = (reason: string) => ({ confidence: 1, reason, tier: "code" });
        const llm = (confidence: number, reason: string) => ({ confidence, reason, tier: "llm" });
        expect(groups).toEqual([
            { key: "beads X-12 scope", status: "applied", ...code("alias nazaries") },
            { key: "beads X-12 autonomy", status: "applied", ...llm(0.96, "review") },
            { key: "beads X-12 stage", status: "applied", ...code("follows autonomy HITL") },
            { key: "github owner/repo#2 autonomy", status: "applied", ...llm(0.97, "clear") },
            {
                key: "github owner/repo#2 stage",
                status: "applied",
                ...code("follows autonomy AFK"),
            },
            {
                key: "linear DOT-3 scope",
                status: "failed",
                ...code("every linear task is personal"),
            },
            { key: "linear DOT-3 autonomy", status: "proposed", ...llm(0.96, "review") },
            { key: "linear DOT-3 stage", status: "proposed", ...code("follows autonomy HITL") },
            { key: "github owner/repo#2 scope", status: "asked", ...llm(0.6, "maybe work") },
        ]);
        expect(data.sources.map((s) => Object.keys(s.missing))).toEqual([
            ["scope", "autonomy", "stage"],
            ["scope", "autonomy", "stage"],
            ["scope", "autonomy", "stage"],
        ]);
        expect(JSON.stringify(data)).not.toContain("entry");
        expect(data.records.every((r) => r.title !== "" && r.labels.length > 0)).toBe(true);
    });
});
