import { describe, expect, it } from "vitest";

import type { Group } from "../label-contract/contract.ts";
import type { JudgementAnswer, JudgementRequest } from "./judgement.ts";
import { labelTriageStep } from "./step.ts";
import { config, triageContext, fakeJudgement, task, trackers } from "./test-fixtures.ts";

const EMPTY = {
    sources: [],
    records: [],
    conflicts: [],
    notJudged: [],
    remainder: 0,
    judgement: null,
    failures: [],
};

const ANSWERS: Record<Group, string[]> = { scope: ["work"], entry: ["AFK"] };

// Answers every requested group of every task: `work` for scope, `AFK` for entry.
function judgeAll(confidence = 0.97, calls?: string[]) {
    return fakeJudgement((request: JudgementRequest) => {
        calls?.push("judgement");
        return {
            ok: true,
            answers: request.tasks.map((t) => {
                const answer: JudgementAnswer = { id: t.id };
                for (const group of t.groups) {
                    answer[group] = {
                        labels: ANSWERS[group],
                        confidence,
                        reason: `judged ${group}`,
                    };
                }
                return answer;
            }),
        };
    });
}

describe("label triage: reading fails closed", () => {
    it("is not evaluable naming beads and bd when bd cannot be executed, reading no other source", async () => {
        const calls: string[] = [];
        const result = await labelTriageStep.run(
            triageContext({
                trackers: trackers(calls, {
                    beads: "bd list --json: bd CLI not found on PATH",
                    github: [task("github", "owner/repo#1", [])],
                    linear: [task("linear", "DOT-1", [])],
                }),
            }),
        );
        expect(result).toEqual({
            step: "label-triage",
            tier: "code",
            outcome: "not-evaluable",
            reasons: ["beads: bd list --json: bd CLI not found on PATH"],
            data: EMPTY,
        });
        expect(calls).toEqual(["beads:listTasks"]);
    });

    it("is not evaluable naming linear auth login when Linear is not authenticated, with no partial evaluation", async () => {
        const calls: string[] = [];
        const judgement = judgeAll();
        const result = await labelTriageStep.run(
            triageContext({
                trackers: trackers(calls, {
                    beads: [task("beads", "B-1", ["nazaries"])],
                    linear: "linear issue query --all-teams: Linear CLI is not authenticated, run `linear auth login`",
                }),
                judgement,
                args: { apply: true },
            }),
        );
        expect(result.outcome).toBe("not-evaluable");
        expect(result.reasons).toEqual([
            "linear: linear issue query --all-teams: Linear CLI is not authenticated, run `linear auth login`",
        ]);
        expect(result.data).toEqual(EMPTY);
        expect(calls).toEqual(["beads:listTasks", "github:listTasks", "linear:listTasks"]);
        expect(judgement.requests).toEqual([]);
    });

    it("is not evaluable with the configuration error when the configuration cannot be loaded", async () => {
        const calls: string[] = [];
        const error = "configuration file not found at /home/me/.config/autonomous/config.json";
        const result = await labelTriageStep.run(
            triageContext({
                config: { ok: false, path: "/home/me/.config/autonomous/config.json", error },
                trackers: trackers(calls, { beads: [task("beads", "B-1", [])] }),
            }),
        );
        expect(result.outcome).toBe("not-evaluable");
        expect(result.reasons).toEqual([error]);
        expect(result.data).toEqual(EMPTY);
        expect(calls).toEqual([]);
    });
});

describe("label triage: detection and counts", () => {
    it("counts per source and group, reporting conflicts and leaving complete tasks alone", async () => {
        const calls: string[] = [];
        const result = await labelTriageStep.run(
            triageContext({
                trackers: trackers(calls, {
                    beads: [
                        task("beads", "B-1", ["work", "AFK"]),
                        task("beads", "B-2", ["nazaries"]),
                        task("beads", "B-3", ["personal", "AFK", "HITL"]),
                    ],
                    github: [
                        task("github", "owner/repo#1", ["work", "personal", "HITL"]),
                        task("github", "owner/repo#2", []),
                    ],
                    linear: [task("linear", "DOT-1", ["personal", "HITL"])],
                }),
                judgement: judgeAll(),
            }),
        );
        expect(result.outcome).toBe("advance");
        expect(result.data.sources).toEqual([
            {
                source: "beads",
                read: 3,
                complete: 1,
                missing: { scope: 1, entry: 1 },
                conflict: { scope: 0, entry: 1 },
            },
            {
                source: "github",
                read: 2,
                complete: 0,
                missing: { scope: 1, entry: 1 },
                conflict: { scope: 1, entry: 0 },
            },
            {
                source: "linear",
                read: 1,
                complete: 1,
                missing: { scope: 0, entry: 0 },
                conflict: { scope: 0, entry: 0 },
            },
        ]);
        expect(result.data.conflicts).toEqual([
            {
                source: "beads",
                taskId: "B-3",
                title: "Task B-3",
                group: "entry",
                labels: ["AFK", "HITL"],
            },
            {
                source: "github",
                taskId: "owner/repo#1",
                title: "Task owner/repo#1",
                group: "scope",
                labels: ["work", "personal"],
            },
        ]);
        expect(result.data.records.map((r) => [r.taskId, r.group])).toEqual([
            ["B-2", "scope"],
            ["B-2", "entry"],
            ["owner/repo#2", "scope"],
            ["owner/repo#2", "entry"],
        ]);
        expect(result.reasons).toEqual([
            "beads: 3 read, 1 complete, 1 missing scope, 1 missing entry, 1 in conflict",
            "github: 2 read, 0 complete, 1 missing scope, 1 missing entry, 1 in conflict",
            "linear: 1 read, 1 complete, 0 missing scope, 0 missing entry, 0 in conflict",
            "proposed 4 labels",
            "2 groups for the human",
        ]);
    });

    it("derives work by rule from the Beads alias nazaries and judges only the entry group", async () => {
        const judgement = judgeAll();
        const result = await labelTriageStep.run(
            triageContext({
                trackers: trackers([], { beads: [task("beads", "X-12", ["nazaries"])] }),
                judgement,
            }),
        );
        expect(result.data.records[0]).toEqual({
            source: "beads",
            taskId: "X-12",
            title: "Task X-12",
            group: "scope",
            labels: ["work"],
            confidence: 1,
            reason: "alias nazaries",
            tier: "code",
            status: "proposed",
            detail: null,
        });
        expect(judgement.requests.map((r) => r.tasks.map((t) => [t.id, t.groups]))).toEqual([
            [["X-12", ["entry"]]],
        ]);
    });

    it("never sends a conflicting group to judgement, judging the other group of the task alone", async () => {
        const judgement = judgeAll();
        const result = await labelTriageStep.run(
            triageContext({
                trackers: trackers([], { beads: [task("beads", "B-3", ["AFK", "HITL"])] }),
                judgement,
            }),
        );
        expect(judgement.requests.map((r) => r.tasks.map((t) => [t.id, t.groups]))).toEqual([
            [["B-3", ["scope"]]],
        ]);
        expect(result.data.records.map((r) => [r.taskId, r.group, r.labels])).toEqual([
            ["B-3", "scope", ["work"]],
        ]);
        expect(result.data.conflicts.map((c) => [c.taskId, c.group])).toEqual([["B-3", "entry"]]);
    });

    it("skips a disabled source and omits it from the counts", async () => {
        const calls: string[] = [];
        const disabled = config();
        disabled.sources.github.enabled = false;
        const result = await labelTriageStep.run(
            triageContext({
                config: disabled,
                trackers: trackers(calls, {
                    beads: [task("beads", "B-1", ["work", "AFK"])],
                    github: "gh must not be called",
                    linear: [task("linear", "DOT-1", ["personal", "HITL"])],
                }),
            }),
        );
        expect(result.outcome).toBe("advance");
        expect(calls).toEqual(["beads:listTasks", "linear:listTasks"]);
        expect(result.data.sources.map((s) => s.source)).toEqual(["beads", "linear"]);
    });
});

describe("label triage: judgement degrades", () => {
    it("reads a Linear task's description through readTask before judging it", async () => {
        const calls: string[] = [];
        const judgement = judgeAll(0.97, calls);
        await labelTriageStep.run(
            triageContext({
                trackers: trackers(
                    calls,
                    { linear: [task("linear", "DOT-2", [])] },
                    { linear: { descriptions: { "DOT-2": "Refine the plan with me" } } },
                ),
                judgement,
            }),
        );
        expect(calls).toEqual([
            "beads:listTasks",
            "github:listTasks",
            "linear:listTasks",
            "linear:readTask:DOT-2",
            "judgement",
        ]);
        // Linear's structural scope settles the scope group by rule; only entry is judged.
        expect(judgement.requests[0]?.tasks).toEqual([
            {
                id: "DOT-2",
                source: "linear",
                title: "Task DOT-2",
                description: "Refine the plan with me",
                labels: [],
                groups: ["entry"],
            },
        ]);
    });

    it("leaves a task not judged when its description cannot be read", async () => {
        const judgement = judgeAll();
        const error = "linear issue view DOT-2 --json: linear timed out after 120 s";
        const result = await labelTriageStep.run(
            triageContext({
                trackers: trackers(
                    [],
                    { linear: [task("linear", "DOT-2", [])] },
                    { linear: { readErrors: { "DOT-2": error } } },
                ),
                judgement,
            }),
        );
        expect(result.outcome).toBe("advance");
        expect(judgement.requests).toEqual([]);
        expect(result.data.notJudged).toEqual([
            { source: "linear", taskId: "DOT-2", reason: error },
        ]);
        expect(result.data.judgement).toEqual({
            model: "claude-sonnet-5",
            effort: "medium",
            cap: 25,
            batches: 0,
        });
    });

    it("advances with every task of a failed batch not judged, keeping the rule records", async () => {
        const error = "claude timed out after 300 s";
        const result = await labelTriageStep.run(
            triageContext({
                trackers: trackers([], {
                    beads: [task("beads", "B-2", ["nazaries"])],
                    github: [task("github", "owner/repo#2", [])],
                }),
                judgement: fakeJudgement(() => ({ ok: false, error })),
            }),
        );
        expect(result.outcome).toBe("advance");
        expect(result.data.notJudged).toEqual([
            { source: "beads", taskId: "B-2", reason: error },
            { source: "github", taskId: "owner/repo#2", reason: error },
        ]);
        expect(result.data.records.map((r) => [r.taskId, r.group, r.tier, r.status])).toEqual([
            ["B-2", "scope", "code", "proposed"],
        ]);
        expect(result.reasons).toContain("2 tasks not judged, 0 beyond the cap of 25");
    });

    it("reports a task the judgement leaves out as not judged", async () => {
        const result = await labelTriageStep.run(
            triageContext({
                trackers: trackers([], { github: [task("github", "owner/repo#2", [])] }),
                judgement: fakeJudgement(() => ({ ok: true, answers: [] })),
            }),
        );
        expect(result.data.notJudged).toEqual([
            { source: "github", taskId: "owner/repo#2", reason: "missing from the judgement" },
        ]);
        expect(result.data.records).toEqual([]);
    });

    it("judges up to the cap in batches, in order, and reports the remainder", async () => {
        const settings = config();
        settings.judgement.cap = 3;
        settings.judgement.batch = 2;
        const judgement = judgeAll();
        const tasks = [1, 2, 3, 4, 5].map((n) =>
            task("github", `owner/repo#${n}`, [], { updatedAt: `2026-09-2${n}T10:00:00Z` }),
        );
        const result = await labelTriageStep.run(
            triageContext({
                config: settings,
                trackers: trackers([], { github: tasks }),
                judgement,
            }),
        );
        expect(judgement.requests.map((r) => r.tasks.map((t) => t.id))).toEqual([
            ["owner/repo#5", "owner/repo#4"],
            ["owner/repo#3"],
        ]);
        expect(result.data.remainder).toBe(2);
        expect(result.data.judgement).toEqual({
            model: "claude-sonnet-5",
            effort: "medium",
            cap: 3,
            batches: 2,
        });
        expect(result.reasons).toContain("0 tasks not judged, 2 beyond the cap of 3");
    });

    it("asks the human for a judgement below the threshold, keeping its confidence", async () => {
        const result = await labelTriageStep.run(
            triageContext({
                trackers: trackers([], { beads: [task("beads", "X-12", ["nazaries"])] }),
                judgement: judgeAll(0.8),
            }),
        );
        expect(result.data.records[1]).toMatchObject({
            taskId: "X-12",
            group: "entry",
            labels: ["AFK"],
            confidence: 0.8,
            tier: "llm",
            status: "asked",
            detail: "below threshold 0.95: 0.80",
        });
        expect(result.reasons).toContain("1 group for the human");
    });
});

describe("label triage: writing only with --apply", () => {
    const listing = () => ({ beads: [task("beads", "X-12", ["nazaries"])] });

    it("proposes every eligible record and writes nothing without --apply", async () => {
        const calls: string[] = [];
        const result = await labelTriageStep.run(
            triageContext({ trackers: trackers(calls, listing()), judgement: judgeAll() }),
        );
        expect(result.data.records.map((r) => [r.group, r.labels, r.status])).toEqual([
            ["scope", ["work"], "proposed"],
            ["entry", ["AFK"], "proposed"],
        ]);
        expect(calls.filter((c) => c.includes("addLabel"))).toEqual([]);
        expect(result.reasons).toContain("proposed 2 labels");
    });

    it("applies with --apply, reading every write back, without changing its own findings", async () => {
        const calls: string[] = [];
        const result = await labelTriageStep.run(
            triageContext({
                trackers: trackers(calls, listing()),
                judgement: judgeAll(),
                args: { apply: true },
            }),
        );
        expect(result.outcome).toBe("advance");
        expect(result.data.records.map((r) => [r.group, r.labels, r.status])).toEqual([
            ["scope", ["work"], "applied"],
            ["entry", ["AFK"], "applied"],
        ]);
        expect(calls.slice(3)).toEqual([
            "beads:addLabel:X-12:work",
            "beads:readTask:X-12",
            "beads:addLabel:X-12:AFK",
            "beads:readTask:X-12",
        ]);
        expect(result.data.sources[0]?.missing).toEqual({ scope: 1, entry: 1 });
        expect(result.reasons).toContain("applied 2 labels");
    });

    it("reports a write failure and still advances", async () => {
        const error = "bd label add X-12 work: bd failed: database is locked";
        const result = await labelTriageStep.run(
            triageContext({
                trackers: trackers([], listing(), { beads: { addLabelError: error } }),
                judgement: judgeAll(),
                args: { apply: true },
            }),
        );
        expect(result.outcome).toBe("advance");
        expect(result.data.failures).toEqual([
            {
                source: "beads",
                taskId: "X-12",
                labels: ["work"],
                before: ["nazaries"],
                after: null,
                error,
            },
        ]);
        expect(result.data.records.map((r) => [r.group, r.status])).toEqual([
            ["scope", "failed"],
            ["entry", "proposed"],
        ]);
        expect(result.reasons).toContain("1 write failure");
    });
});
