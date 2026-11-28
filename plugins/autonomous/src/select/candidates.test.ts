import { rmSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import { taskKey } from "../attempts/record.ts";
import { tempState } from "../attempts/test-fixtures.ts";
import type { Exec } from "../exec.ts";
import { LABEL_TRIAGE } from "../label-triage/question-id.ts";
import type { LabelTriageData } from "../label-triage/step.ts";
import { config } from "../label-triage/test-fixtures.ts";
import type { TriageRecord } from "../label-triage/write.ts";
import { NOW } from "../quota-gate/test-fixtures.ts";
import { ALL_PASSED, CONFIG, run } from "../review-bots/test-fixtures.ts";
import type { StepResult } from "../runner.ts";
import { labelledThisRun, selectCandidates } from "./candidates.ts";
import subIssues from "./readers/fixtures/github-subissues.json";
import { githubWorkReader } from "./readers/github.ts";
import { BRANCH, stateWithWorkspace } from "../transition/test-fixtures.ts";
import { fakePullRequests, type PullRequestFacts, workTask } from "./test-fixtures.ts";
import type { WorkTask } from "./types.ts";
import { reviewBotsCheck } from "./wait.ts";

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

// `output` is what `gh issue view --json subIssues` prints for the issue.
async function githubIssue(output: unknown) {
    const issue = {
        number: 1,
        title: "Synthetic issue",
        body: "",
        labels: [{ name: "personal" }, { name: "grill-me" }],
        updatedAt: "2026-01-01T00:00:00Z",
        state: "OPEN",
    };
    const exec: Exec = (args) =>
        Promise.resolve({
            ok: true,
            stdout: JSON.stringify(args[1] === "list" ? [issue] : output),
        });
    const reader = githubWorkReader(exec, { enabled: true, repos: ["owner/repo"] });
    const listed = await reader.list();
    if (!listed.ok) throw new Error(listed.error);
    return { tasks: listed.value, detail: (task: WorkTask) => reader.detail(task) };
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
            marked: [],
            unmarked: [],
            markedRead: 0,
        },
    };
}

function record(overrides: Partial<TriageRecord> = {}): TriageRecord {
    return {
        source: "linear",
        taskId: "TEST-1",
        title: "Task TEST-1",
        group: "stage",
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
                candidates: [{ task, scope: "personal", autonomy: null, stage: "grill-me" }],
                excluded: [],
                readyToClose: [],
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

    // spec work-selection, "A marked task is excluded"
    it("excludes a task carrying triage-me as triage-me (stale mark)", async () => {
        const task = workTask("linear", "TEST-1", ["personal", "grill-me", "triage-me"]);

        expect(await evaluate([task])).toMatchObject({
            ok: true,
            value: {
                candidates: [],
                excluded: [
                    { source: "linear", id: "TEST-1", title: task.title, reason: "triage-me" },
                ],
            },
        });
    });

    it("excludes a marked task without autonomy or stage under classification (marked and incomplete)", async () => {
        const task = workTask("linear", "TEST-1", ["personal", "triage-me"]);

        expect(await evaluate([task])).toMatchObject({
            ok: true,
            value: { candidates: [], excluded: [{ reason: "classification" }] },
        });
    });

    it("excludes a taken and marked task as taken", async () => {
        const task = workTask("linear", "TEST-1", ["personal", "grill-me", "taken", "triage-me"]);

        expect(await evaluate([task])).toMatchObject({
            ok: true,
            value: { candidates: [], excluded: [{ reason: "taken" }] },
        });
    });

    it("excludes a marked task as triage-me before labelled this run and detail", async () => {
        const task = workTask("linear", "TEST-1", ["personal", "AFK", "implement", "triage-me"], {
            blockedBy: ["TEST-0"],
        });
        const detail = vi.fn(() => Promise.reject(new Error("detail must not be read")));

        expect(
            await evaluate([task], { detail, labelledThisRun: new Set(["linear:TEST-1"]) }),
        ).toMatchObject({
            ok: true,
            value: { candidates: [], excluded: [{ reason: "triage-me" }] },
        });
        expect(detail).not.toHaveBeenCalled();
    });

    it("does not exclude a task read without the mark, nothing written to it (mark removed in this run)", async () => {
        const task = workTask("linear", "TEST-1", ["work", "HITL", "proposal"]);

        expect(await evaluate([task])).toMatchObject({
            ok: true,
            value: { candidates: [{ task, stage: "proposal" }], excluded: [] },
        });
    });

    it("reports taken, not unsupported stage, for a taken AFK task", async () => {
        const task = workTask("beads", "task-1", ["work", "AFK", "proposal", "taken"]);

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

    it("excludes a task without a stage label under classification", async () => {
        const task = workTask("linear", "TEST-1", ["personal", "AFK"]);

        expect(await evaluate([task])).toMatchObject({
            ok: true,
            value: { candidates: [], excluded: [{ reason: "classification" }] },
        });
    });

    it.each([
        ["personal", "work", "grill-me"],
        ["personal"],
        ["personal", "proposal"],
        ["personal", "AFK", "HITL", "grill-me"],
        ["personal", "AFK", "grill-me", "proposal"],
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
        { labels: ["personal", "AFK", "qa"], reason: "unsupported-stage" },
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

    it("Task ready to implement: is a candidate, not excluded as an unsupported stage", async () => {
        const task = workTask("linear", "TEST-1", ["personal", "AFK", "implement"]);

        expect(await evaluate([task])).toMatchObject({
            ok: true,
            value: { candidates: [{ task, autonomy: "AFK", stage: "implement" }], excluded: [] },
        });
    });

    it("Task ready to verify: is a candidate, not excluded as an unsupported stage", async () => {
        const task = workTask("linear", "TEST-1", ["personal", "AFK", "verify"]);

        expect(await evaluate([task])).toMatchObject({
            ok: true,
            value: { candidates: [{ task, autonomy: "AFK", stage: "verify" }], excluded: [] },
        });
    });

    it("Task ready for code review: is a candidate, not excluded as an unsupported stage", async () => {
        const task = workTask("linear", "TEST-1", ["personal", "AFK", "code-review"]);

        expect(await evaluate([task])).toMatchObject({
            ok: true,
            value: { candidates: [{ task, autonomy: "AFK", stage: "code-review" }], excluded: [] },
        });
    });

    it("Task waiting for external review: is a candidate, not excluded as an unsupported stage", async () => {
        const task = workTask("linear", "TEST-1", ["personal", "HITL", "external-review"]);

        expect(await evaluate([task])).toMatchObject({
            ok: true,
            value: {
                candidates: [{ task, autonomy: "HITL", stage: "external-review" }],
                excluded: [],
            },
        });
    });

    it.each(["qa", "wrap-up", "ready-to-merge"])(
        "Task in a stage declared later: %s is excluded as an unsupported stage",
        async (stage) => {
            const task = workTask("linear", "TEST-1", ["personal", "AFK", stage]);

            expect(await evaluate([task])).toMatchObject({
                ok: true,
                value: { candidates: [], excluded: [{ reason: "unsupported-stage" }] },
            });
        },
    );

    it("keeps an AFK task in proposal as a candidate", async () => {
        const task = workTask("linear", "TEST-1", ["personal", "AFK", "proposal"]);

        expect(await evaluate([task])).toMatchObject({
            ok: true,
            value: { candidates: [{ task, autonomy: "AFK", stage: "proposal" }], excluded: [] },
        });
    });

    it("skips the unsupported-stage check when the stage is supplied", async () => {
        const task = workTask("linear", "TEST-1", ["personal", "AFK", "proposal"]);

        expect(await evaluate([task], { stage: "test" })).toMatchObject({
            ok: true,
            value: { candidates: [{ task, stage: "proposal" }], excluded: [] },
        });
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
                readyToClose: [],
            },
        });
    });

    it("does not exclude a GitHub task as blocked, its dependencies being unevaluated", async () => {
        const { tasks, detail } = await githubIssue({ subIssues: { nodes: [], totalCount: 0 } });

        expect(tasks[0]).toMatchObject({ blockedBy: null });
        expect(await evaluate(tasks, { detail })).toMatchObject({
            ok: true,
            value: { candidates: [{ task: { id: "owner/repo#1", children: [] } }], excluded: [] },
        });
    });

    it("excludes a GitHub issue with an open sub-issue as split", async () => {
        const { tasks, detail } = await githubIssue(subIssues);

        expect(await evaluate(tasks, { detail })).toEqual({
            ok: true,
            value: {
                candidates: [],
                excluded: [
                    {
                        source: "github",
                        id: "owner/repo#1",
                        title: "Synthetic issue",
                        reason: "split",
                    },
                ],
                readyToClose: [],
            },
        });
    });

    it("excludes a parent in proposal whose subtasks are all closed as split, ready to close", async () => {
        const task = workTask("linear", "TEST-1", ["personal", "AFK", "proposal"], {
            children: [],
            childCount: 2,
        });

        expect(await evaluate([task])).toEqual({
            ok: true,
            value: {
                candidates: [],
                excluded: [{ source: "linear", id: "TEST-1", title: task.title, reason: "split" }],
                readyToClose: [{ source: "linear", id: "TEST-1", title: task.title }],
            },
        });
    });

    it("excludes a parent in proposal with an open subtask as split, not ready to close", async () => {
        const task = workTask("linear", "TEST-1", ["personal", "AFK", "proposal"], {
            children: ["TEST-2"],
            childCount: 3,
        });

        expect(await evaluate([task])).toMatchObject({
            ok: true,
            value: { candidates: [], excluded: [{ reason: "split" }], readyToClose: [] },
        });
    });

    it("keeps a grill of a task whose only subtask is closed as a candidate", async () => {
        const task = workTask("linear", "TEST-1", ["personal", "grill-me"], {
            children: [],
            childCount: 1,
        });

        expect(await evaluate([task])).toMatchObject({
            ok: true,
            value: { candidates: [{ task, stage: "grill-me" }], excluded: [], readyToClose: [] },
        });
    });

    it("does not exclude a task in proposal that never had a child", async () => {
        const task = workTask("beads", "task-1", ["personal", "AFK", "proposal"], {
            children: [],
            childCount: 0,
        });

        expect(await evaluate([task])).toMatchObject({
            ok: true,
            value: { candidates: [{ task, stage: "proposal" }], excluded: [], readyToClose: [] },
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

    it("keeps a grill task without autonomy as a candidate with a null autonomy", async () => {
        const task = workTask("beads", "task-1", ["work", "grill-me"]);

        expect(await evaluate([task])).toMatchObject({
            ok: true,
            value: { candidates: [{ task, scope: "work", autonomy: null, stage: "grill-me" }] },
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

    it("excludes a task whose triage write failed after adding grill-me", async () => {
        const task = workTask();
        const failed = record({ status: "failed", detail: "linear: add label failed" });

        expect(
            await evaluate([task], { labelledThisRun: labelledThisRun([triageResult([failed])]) }),
        ).toMatchObject({
            ok: true,
            value: { candidates: [], excluded: [{ reason: "labelled-this-run" }] },
        });
    });

    it.each<TriageRecord["status"]>(["proposed", "asked"])(
        "does not exclude a task triage only left %s",
        async (status) => {
            const task = workTask();

            expect(
                await evaluate([task], {
                    labelledThisRun: labelledThisRun([triageResult([record({ status })])]),
                }),
            ).toMatchObject({
                ok: true,
                value: { candidates: [{ task }], excluded: [] },
            });
        },
    );

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

describe("selectCandidates: no free slot", () => {
    const grill = workTask("linear", "G-1", ["personal", "grill-me"]);
    const proposal = workTask("linear", "P-1", ["personal", "AFK", "proposal"]);

    it("excludes the grill-me task when the grill kind is full and keeps the proposal task", async () => {
        const result = await evaluate([grill, proposal], { full: { grill: true, work: false } });

        expect(result).toEqual({
            ok: true,
            value: {
                candidates: [expect.objectContaining({ task: proposal, stage: "proposal" })],
                excluded: [
                    { source: "linear", id: "G-1", title: "Task G-1", reason: "no-free-slot" },
                ],
                readyToClose: [],
            },
        });
    });

    it("excludes a proposal task when the work kind is full", async () => {
        const result = await evaluate([grill, proposal], { full: { grill: false, work: true } });

        expect(result).toMatchObject({
            ok: true,
            value: {
                candidates: [{ task: grill }],
                excluded: [{ id: "P-1", reason: "no-free-slot" }],
            },
        });
    });

    it("excludes a blocked grill-me task as blocked, not as no free slot", async () => {
        const blocked = workTask("linear", "G-2", ["personal", "grill-me"], { blockedBy: ["X-1"] });

        const result = await evaluate([blocked], { full: { grill: true, work: true } });

        expect(result).toMatchObject({ ok: true, value: { excluded: [{ reason: "blocked" }] } });
    });

    it("excludes a split task as split, not as no free slot", async () => {
        const parent = workTask("linear", "G-3", ["personal", "grill-me"], { children: ["C-1"] });

        const result = await evaluate([parent], { full: { grill: true, work: true } });

        expect(result).toMatchObject({ ok: true, value: { excluded: [{ reason: "split" }] } });
    });

    it("excludes a proposal parent whose children are all closed as split, ready to close", async () => {
        const parent = workTask("linear", "P-2", ["personal", "AFK", "proposal"], {
            children: [],
            childCount: 1,
        });

        const result = await evaluate([parent], { full: { grill: true, work: true } });

        expect(result).toMatchObject({
            ok: true,
            value: {
                excluded: [{ id: "P-2", reason: "split" }],
                readyToClose: [{ id: "P-2" }],
            },
        });
    });

    it("keeps the grill-me task outside a loop whatever the kinds", async () => {
        const result = await evaluate([grill]);

        expect(result).toMatchObject({
            ok: true,
            value: { candidates: [{ task: grill }], excluded: [] },
        });
    });

    it("keeps the grill-me task when its kind has a free slot", async () => {
        const result = await evaluate([grill], { full: { grill: false, work: true } });

        expect(result).toMatchObject({ ok: true, value: { candidates: [{ task: grill }] } });
    });
});

describe("selectCandidates: waiting for review bots", () => {
    const kept: string[] = [];
    const task = workTask("linear", "DOT-7", ["personal", "AFK", "external-review"]);

    afterEach(() => {
        for (const directory of kept.splice(0)) {
            rmSync(directory, { recursive: true, force: true });
        }
    });

    // The task's attempt record names an existing workspace unless `state` is given.
    async function waitDeps(calls: string[], facts: PullRequestFacts, state?: string) {
        const directories =
            state === undefined
                ? await stateWithWorkspace({ source: task.source, id: task.id })
                : { state, workspace: state };
        kept.push(directories.state, directories.workspace);
        return {
            wait: reviewBotsCheck({
                config: CONFIG,
                state: directories.state,
                pullRequests: fakePullRequests(calls, facts),
                apply: false,
                now: NOW,
            }),
        };
    }

    it("Review bot still reviewing: excludes the task as waiting for review bots", async () => {
        const calls: string[] = [];
        const checkRuns = [...ALL_PASSED.slice(1), run("CodeRabbit", { status: "in_progress" })];
        const result = await evaluate([task], await waitDeps(calls, { checkRuns }));

        expect(result).toMatchObject({
            ok: true,
            value: {
                candidates: [],
                excluded: [
                    {
                        id: "DOT-7",
                        reason: "waiting-for-review-bots",
                        wait: {
                            pullRequest: { number: 12, url: "https://example.test/pull/12" },
                            draft: null,
                            running: [],
                            reasons: ["coderabbit is reviewing"],
                        },
                    },
                ],
            },
        });
        expect(calls).toEqual([
            `pr find ${BRANCH}`,
            "pr state 12",
            "pr checkRuns a1b2c3d",
            "pr threads 12",
            "pr reviews 12",
        ]);
    });

    it("Settled pull request: is a candidate", async () => {
        const result = await evaluate([task], await waitDeps([], { checkRuns: ALL_PASSED }));

        expect(result).toMatchObject({
            ok: true,
            value: { candidates: [{ task, stage: "external-review" }], excluded: [] },
        });
    });

    it("Taken task in external-review: is excluded as taken, and its pull request is not read", async () => {
        const calls: string[] = [];
        const taken = workTask("linear", "DOT-7", ["personal", "AFK", "external-review", "taken"]);
        const result = await evaluate([taken], await waitDeps(calls, {}));

        expect(result).toMatchObject({ ok: true, value: { excluded: [{ reason: "taken" }] } });
        expect(calls).toEqual([]);
    });

    it("No attempt record: excludes the task as waiting, because this machine holds no workspace of it", async () => {
        const calls: string[] = [];
        const result = await evaluate([task], await waitDeps(calls, {}, tempState()));

        expect(result).toMatchObject({
            ok: true,
            value: {
                excluded: [
                    {
                        reason: "waiting-for-review-bots",
                        wait: {
                            pullRequest: null,
                            bots: [],
                            reasons: ["there is no workspace to check: the task has no attempt"],
                        },
                    },
                ],
            },
        });
        expect(calls).toEqual([]);
    });

    it("excludes a task whose branch has no open pull request as waiting, naming the branch", async () => {
        const result = await evaluate([task], await waitDeps([], { found: null }));

        expect(result).toMatchObject({
            ok: true,
            value: {
                excluded: [
                    {
                        reason: "waiting-for-review-bots",
                        wait: { reasons: [`the branch ${BRANCH} has no open pull request`] },
                    },
                ],
            },
        });
    });

    it("excludes a task whose pull request cannot be found as waiting, with the error", async () => {
        const result = await evaluate([task], await waitDeps([], { found: "gh: offline" }));

        expect(result).toMatchObject({
            ok: true,
            value: {
                excluded: [
                    {
                        wait: {
                            reasons: [
                                `cannot find the pull request of the branch ${BRANCH}: gh: offline`,
                            ],
                        },
                    },
                ],
            },
        });
    });

    it("excludes a split task in external-review as split, without reading its pull request", async () => {
        const calls: string[] = [];
        const parent = workTask("linear", "DOT-7", ["personal", "AFK", "external-review"], {
            children: ["DOT-8"],
        });
        const result = await evaluate([parent], await waitDeps(calls, {}));

        expect(result).toMatchObject({ ok: true, value: { excluded: [{ reason: "split" }] } });
        expect(calls).toEqual([]);
    });

    it("excludes a waiting task as waiting for review bots, not as no free slot", async () => {
        const deps = await waitDeps([], { checkRuns: [] });
        const result = await evaluate([task], { ...deps, full: { grill: false, work: true } });

        expect(result).toMatchObject({
            ok: true,
            value: { excluded: [{ reason: "waiting-for-review-bots" }] },
        });
    });

    it("reads no pull request for a task in another stage", async () => {
        const calls: string[] = [];
        const implement = workTask("linear", "DOT-7", ["personal", "AFK", "implement"]);
        const result = await evaluate([implement], await waitDeps(calls, {}));

        expect(result).toMatchObject({ ok: true, value: { candidates: [{ stage: "implement" }] } });
        expect(calls).toEqual([]);
    });

    it("keeps an unsettled task as a candidate without a wait check, as launch checks a supplied task", async () => {
        expect(await evaluate([task])).toMatchObject({
            ok: true,
            value: { candidates: [{ task, stage: "external-review" }], excluded: [] },
        });
    });
});

describe("labelledThisRun", () => {
    it("takes applied and failed records from label-triage and deduplicates task keys", () => {
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

        expect(labelledThisRun(results)).toEqual(
            new Set(["linear:TEST-1", "beads:TEST-1", "linear:TEST-4"]),
        );
    });

    it("counts a failed record as labelled, since a write was attempted", () => {
        const failed = record({ status: "failed", detail: "linear: add label failed" });

        expect(labelledThisRun([triageResult([failed])])).toEqual(new Set(["linear:TEST-1"]));
    });

    it("does not count a proposed record skipped after a write failure", () => {
        const skipped = record({
            status: "proposed",
            detail: "skipped after a write failure",
        });

        expect(labelledThisRun([triageResult([skipped])])).toEqual(new Set());
    });

    it("returns no labelled tasks without an applied record", () => {
        expect(labelledThisRun([])).toEqual(new Set());
        expect(labelledThisRun([triageResult([record({ status: "proposed" })])])).toEqual(
            new Set(),
        );
    });
});
