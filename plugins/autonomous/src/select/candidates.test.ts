import { describe, expect, it, vi } from "vitest";

import { LABEL_TRIAGE } from "../label-triage/question-id.ts";
import type { LabelTriageData } from "../label-triage/step.ts";
import { config } from "../label-triage/test-fixtures.ts";
import { taskKey, type TriageRecord } from "../label-triage/write.ts";
import type { StepResult } from "../runner.ts";
import { labelledThisRun, selectCandidates } from "./candidates.ts";
import { workTask } from "./test-fixtures.ts";
import type { WorkTask } from "./types.ts";

function evaluate(
    tasks: WorkTask[],
    overrides: Partial<Parameters<typeof selectCandidates>[1]> = {},
) {
    return selectCandidates(tasks, {
        config: config(),
        labelledThisRun: new Set(),
        detail: (task) => Promise.resolve({ ok: true, value: task }),
        ...overrides,
    });
}

function triageResult(records: TriageRecord[]): StepResult<LabelTriageData> {
    return {
        step: LABEL_TRIAGE,
        outcome: "advance",
        tier: "code",
        reasons: [],
        data: {
            sources: [],
            records,
            conflicts: [],
            notJudged: [],
            remainder: 0,
            judgement: null,
            failures: [],
        },
    };
}

function record(overrides: Partial<TriageRecord> = {}): TriageRecord {
    return {
        source: "linear",
        taskId: "TEST-1",
        title: "Task TEST-1",
        group: "entry",
        labels: ["grill-me"],
        confidence: 1,
        reason: "Test classification",
        tier: "code",
        status: "applied",
        detail: null,
        ...overrides,
    };
}

describe("selectCandidates", () => {
    it("keeps an unblocking task and the tasks it blocks", async () => {
        const task = workTask("linear", "TEST-1", undefined, { blocks: ["TEST-2", "TEST-3"] });

        expect(await evaluate([task])).toEqual({
            ok: true,
            value: {
                candidates: [{ task, scope: "personal", autonomy: "grill-me", stage: "grill-me" }],
                excluded: [],
            },
        });
    });

    it("excludes a taken grill-me task", async () => {
        const task = workTask("linear", "TEST-1", ["personal", "grill-me", "taken"]);

        expect(await evaluate([task])).toMatchObject({
            ok: true,
            value: {
                candidates: [],
                excluded: [{ source: "linear", id: "TEST-1", title: task.title, reason: "taken" }],
            },
        });
    });

    it("reports taken before unsupported stage for an AFK task", async () => {
        const task = workTask("beads", "task-1", ["work", "AFK", "taken"]);

        expect(await evaluate([task])).toMatchObject({
            ok: true,
            value: { candidates: [], excluded: [{ reason: "taken" }] },
        });
    });

    it("keeps an in_progress task without taken", async () => {
        const task = workTask("beads", "task-1", ["work", "grill-me"], { status: "in_progress" });

        expect(await evaluate([task])).toMatchObject({
            ok: true,
            value: { candidates: [{ task, scope: "work" }], excluded: [] },
        });
    });

    it("excludes a task labelled this run, and permits it next run", async () => {
        const task = workTask();

        expect(
            await evaluate([task], { labelledThisRun: new Set([taskKey(task.source, task.id)]) }),
        ).toMatchObject({
            ok: true,
            value: { candidates: [], excluded: [{ reason: "labelled-this-run" }] },
        });
        expect(await evaluate([task])).toMatchObject({
            ok: true,
            value: { candidates: [{ task }], excluded: [] },
        });
    });

    it("excludes a parent whose detail reveals an open child", async () => {
        const task = workTask("linear", "TEST-1", undefined, { children: null });
        const detail = vi.fn((listed: WorkTask) =>
            Promise.resolve({ ok: true as const, value: { ...listed, children: ["TEST-2"] } }),
        );

        expect(await evaluate([task], { detail })).toMatchObject({
            ok: true,
            value: { candidates: [], excluded: [{ reason: "split" }] },
        });
        expect(detail).toHaveBeenCalledExactlyOnceWith(task);
    });

    it("does not use an alias to rescue a missing scope", async () => {
        const task = workTask("beads", "task-1", ["nazaries", "grill-me"]);

        expect(await evaluate([task])).toMatchObject({
            ok: true,
            value: { candidates: [], excluded: [{ reason: "classification" }] },
        });
    });

    it("does not use a structural rule to rescue a missing scope", async () => {
        expect(await evaluate([workTask("linear", "TEST-1", ["grill-me"])])).toMatchObject({
            ok: true,
            value: { candidates: [], excluded: [{ reason: "classification" }] },
        });
    });

    it.each([
        ["personal", "work", "grill-me"],
        ["personal"],
        ["personal", "AFK", "HITL", "grill-me"],
    ])("excludes missing or conflicting classification %j", async (...labels) => {
        expect(await evaluate([workTask("linear", "TEST-1", labels)])).toMatchObject({
            ok: true,
            value: { candidates: [], excluded: [{ reason: "classification" }] },
        });
    });

    it.each([
        { labels: ["grill-me", "taken"], reason: "classification" },
        { labels: ["personal", "grill-me", "taken"], reason: "taken" },
        { labels: ["personal", "grill-me"], reason: "labelled-this-run", labelled: true },
        { labels: ["personal", "AFK"], reason: "unsupported-stage" },
        { labels: ["personal", "grill-me"], reason: "blocked", blocked: true },
    ])("never reads detail for $reason", async ({ labels, reason, labelled, blocked }) => {
        const task = workTask("linear", "TEST-1", labels, {
            blockedBy: blocked ? ["TEST-0"] : [],
            children: ["TEST-2"],
        });
        const detail = vi.fn(() => Promise.reject(new Error("detail must not be read")));

        expect(
            await evaluate([task], {
                detail,
                labelledThisRun: new Set(labelled ? ["linear:TEST-1"] : []),
            }),
        ).toMatchObject({
            ok: true,
            value: { candidates: [], excluded: [{ reason }] },
        });
        expect(detail).not.toHaveBeenCalled();
    });

    it("reports each excluded task only under its first applicable check", async () => {
        const task = workTask("linear", "TEST-1", ["grill-me", "taken"], {
            blockedBy: ["TEST-0"],
            children: ["TEST-2"],
        });

        expect(await evaluate([task], { labelledThisRun: new Set(["linear:TEST-1"]) })).toEqual({
            ok: true,
            value: {
                candidates: [],
                excluded: [
                    {
                        source: task.source,
                        id: task.id,
                        title: task.title,
                        reason: "classification",
                    },
                ],
            },
        });
    });

    it("does not exclude GitHub's unevaluated dependencies and children", async () => {
        const task = workTask("github", "owner/repo#1", undefined, {
            priority: null,
            blockedBy: null,
            children: null,
        });

        expect(await evaluate([task])).toMatchObject({
            ok: true,
            value: { candidates: [{ task }], excluded: [] },
        });
    });

    it("keeps the description returned by detail", async () => {
        const task = workTask();
        const detailed = { ...task, description: "Detailed synthetic task", children: [] };

        expect(
            await evaluate([task], {
                detail: () => Promise.resolve({ ok: true, value: detailed }),
            }),
        ).toMatchObject({
            ok: true,
            value: { candidates: [{ task: detailed }] },
        });
    });

    it.each(["AFK", "HITL"])("keeps %s autonomy when combined with grill-me", async (autonomy) => {
        const task = workTask("linear", "TEST-1", ["personal", autonomy, "grill-me"]);

        expect(await evaluate([task])).toMatchObject({
            ok: true,
            value: { candidates: [{ autonomy, stage: "grill-me" }] },
        });
    });

    it("matches taken case-sensitively", async () => {
        const task = workTask("linear", "TEST-1", ["personal", "grill-me", "Taken"]);

        expect(await evaluate([task])).toMatchObject({
            ok: true,
            value: { candidates: [{ task }], excluded: [] },
        });
    });

    it("matches labelled-this-run by source as well as id", async () => {
        expect(
            await evaluate([workTask()], { labelledThisRun: new Set(["beads:TEST-1"]) }),
        ).toMatchObject({
            ok: true,
            value: { candidates: [{ task: { source: "linear", id: "TEST-1" } }] },
        });
    });

    it("passes a detail error through unchanged and stops reading", async () => {
        const detail = vi.fn(() =>
            Promise.resolve({ ok: false as const, error: "linear issue view TEST-1: unavailable" }),
        );

        expect(await evaluate([workTask(), workTask("linear", "TEST-2")], { detail })).toEqual({
            ok: false,
            error: "linear issue view TEST-1: unavailable",
        });
        expect(detail).toHaveBeenCalledTimes(1);
    });
});

describe("labelledThisRun", () => {
    it("takes only applied records from label-triage and deduplicates task keys", () => {
        const results: StepResult[] = [
            { step: "quota-gate", tier: "code", outcome: "advance", reasons: [], data: null },
            triageResult([
                record(),
                record({ group: "scope", labels: ["personal"] }),
                record({ source: "beads" }),
                record({ taskId: "TEST-2", status: "proposed" }),
                record({ taskId: "TEST-3", status: "asked" }),
                record({ taskId: "TEST-4", status: "failed" }),
            ]),
        ];

        expect(labelledThisRun(results)).toEqual(new Set(["linear:TEST-1", "beads:TEST-1"]));
    });

    it("returns no labelled tasks without an applied record", () => {
        expect(labelledThisRun([])).toEqual(new Set());
        expect(labelledThisRun([triageResult([record({ status: "proposed" })])])).toEqual(
            new Set(),
        );
    });
});
