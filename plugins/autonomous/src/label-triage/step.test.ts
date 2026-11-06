import { describe, expect, it } from "vitest";

import { type DecidedGroup, MEANINGS } from "../label-contract/contract.ts";
import type { GroupAnswer, JudgementAnswer, JudgementRequest } from "./judgement.ts";
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

const ANSWERS: Record<DecidedGroup, string[]> = { scope: ["work"], autonomy: ["AFK"] };

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

// Answers every requested group of every task with the judgement given for that group.
function judgeWith(given: Partial<Record<DecidedGroup, GroupAnswer>>) {
    return fakeJudgement((request: JudgementRequest) => ({
        ok: true,
        answers: request.tasks.map((t) => {
            const answer: JudgementAnswer = { id: t.id };
            for (const group of t.groups) {
                const judged = given[group];
                if (judged !== undefined) {
                    answer[group] = judged;
                }
            }
            return answer;
        }),
    }));
}

const UNSURE_HITL = { autonomy: { labels: ["HITL"], confidence: 0.8, reason: "Needs review" } };

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
                        task("beads", "B-1", ["work", "AFK", "proposal"]),
                        task("beads", "B-2", ["nazaries"]),
                        task("beads", "B-3", ["personal", "AFK", "HITL"]),
                        task("beads", "B-4", ["personal", "grill-me"]),
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
                read: 4,
                complete: 2,
                missing: { scope: 1, autonomy: 1, stage: 2 },
                conflict: { scope: 0, autonomy: 1, stage: 0 },
            },
            {
                source: "github",
                read: 2,
                complete: 0,
                missing: { scope: 1, autonomy: 1, stage: 2 },
                conflict: { scope: 1, autonomy: 0, stage: 0 },
            },
            {
                source: "linear",
                read: 1,
                complete: 0,
                missing: { scope: 0, autonomy: 0, stage: 1 },
                conflict: { scope: 0, autonomy: 0, stage: 0 },
            },
        ]);
        expect(result.data.conflicts).toEqual([
            {
                source: "beads",
                taskId: "B-3",
                title: "Task B-3",
                group: "autonomy",
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
        expect(result.data.records.map((r) => [r.taskId, r.group, r.labels])).toEqual([
            ["B-2", "scope", ["work"]],
            ["B-2", "autonomy", ["AFK"]],
            ["B-2", "stage", ["proposal"]],
            ["owner/repo#1", "stage", ["proposal"]],
            ["owner/repo#2", "scope", ["work"]],
            ["owner/repo#2", "autonomy", ["AFK"]],
            ["owner/repo#2", "stage", ["proposal"]],
            ["DOT-1", "stage", ["proposal"]],
        ]);
        expect(result.reasons).toEqual([
            "beads: 4 read, 2 complete, 1 missing scope, 1 missing autonomy, 2 missing stage, 1 in conflict",
            "github: 2 read, 0 complete, 1 missing scope, 1 missing autonomy, 2 missing stage, 1 in conflict",
            "linear: 1 read, 0 complete, 0 missing scope, 0 missing autonomy, 1 missing stage, 0 in conflict",
            "proposed 8 labels",
            "2 groups for the human",
        ]);
    });

    it("derives work by rule from the Beads alias nazaries and judges only the autonomy group", async () => {
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
            [["X-12", ["autonomy"]]],
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
        expect(result.data.conflicts.map((c) => [c.taskId, c.group])).toEqual([
            ["B-3", "autonomy"],
        ]);
    });

    it("lists conflicting scope evidence for the human with both details, judging only the autonomy group", async () => {
        const settings = config();
        settings.sources.beads.scope = "personal";
        const judgement = judgeAll();
        const result = await labelTriageStep.run(
            triageContext({
                config: settings,
                trackers: trackers([], { beads: [task("beads", "X-12", ["nazaries"])] }),
                judgement,
            }),
        );
        expect(result.outcome).toBe("advance");
        expect(judgement.requests.map((r) => r.tasks.map((t) => [t.id, t.groups]))).toEqual([
            [["X-12", ["autonomy"]]],
        ]);
        expect(result.data.records.find((r) => r.status === "asked")).toEqual({
            source: "beads",
            taskId: "X-12",
            title: "Task X-12",
            group: "scope",
            labels: ["work", "personal"],
            confidence: 0,
            reason: "conflicting evidence: alias nazaries; every beads task is personal",
            tier: "code",
            status: "asked",
            detail: "invalid under the contract: two scope labels: work, personal",
        });
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
        // Linear's structural scope settles the scope group by rule; only autonomy is judged.
        expect(judgement.requests[0]?.tasks).toEqual([
            {
                id: "DOT-2",
                source: "linear",
                title: "Task DOT-2",
                description: "Refine the plan with me",
                labels: [],
                groups: ["autonomy"],
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
            group: "autonomy",
            labels: ["AFK"],
            confidence: 0.8,
            tier: "llm",
            status: "asked",
            detail: "below threshold 0.95: 0.80",
        });
        expect(result.reasons).toContain("1 group for the human");
    });
});

describe("label triage: step tier", () => {
    it("is llm when a judgement batch ran and code when evidence settled every group", async () => {
        const judged = await labelTriageStep.run(
            triageContext({
                trackers: trackers([], { github: [task("github", "owner/repo#2", [])] }),
                judgement: judgeAll(),
            }),
        );
        expect(judged.tier).toBe("llm");

        const judgement = judgeAll();
        const settled = await labelTriageStep.run(
            triageContext({
                trackers: trackers([], { beads: [task("beads", "X-12", ["nazaries", "AFK"])] }),
                judgement,
            }),
        );
        expect(judgement.requests).toEqual([]);
        expect(settled.data.records.map((r) => [r.group, r.tier])).toEqual([
            ["scope", "code"],
            ["stage", "code"],
        ]);
        expect(settled.tier).toBe("code");
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
            ["autonomy", ["AFK"], "proposed"],
            ["stage", ["proposal"], "proposed"],
        ]);
        expect(calls.filter((c) => c.includes("addLabel"))).toEqual([]);
        expect(result.reasons).toContain("proposed 3 labels");
    });

    it("applies with --apply scope, autonomy, stage, reading every write back, without changing its own findings", async () => {
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
            ["autonomy", ["AFK"], "applied"],
            ["stage", ["proposal"], "applied"],
        ]);
        expect(calls.slice(3)).toEqual([
            "beads:addLabel:X-12:work",
            "beads:readTask:X-12",
            "beads:addLabel:X-12:AFK",
            "beads:readTask:X-12",
            "beads:addLabel:X-12:proposal",
            "beads:readTask:X-12",
        ]);
        expect(result.data.sources[0]?.missing).toEqual({ scope: 1, autonomy: 1, stage: 1 });
        expect(result.reasons).toContain("applied 3 labels");
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
            ["autonomy", "proposed"],
            ["stage", "proposed"],
        ]);
        expect(result.reasons).toContain("1 write failure");
    });
});

describe("label triage: questions for the human", () => {
    it("asks a judgement below the threshold with the contract's autonomy options, prefixing the judged one", async () => {
        const result = await labelTriageStep.run(
            triageContext({
                trackers: trackers([], { beads: [task("beads", "X-12", ["nazaries"])] }),
                judgement: judgeWith(UNSURE_HITL),
                args: { apply: true },
            }),
        );
        expect(result.questions).toEqual([
            {
                id: "label-triage:beads:X-12:autonomy",
                step: "label-triage",
                header: "X-12",
                question: [
                    'beads X-12 "Task X-12": which autonomy label?',
                    "Seen: labels [nazaries] + written [work] → HITL (llm, 0.80) → below threshold 0.95: 0.80 — Needs review",
                    "Description: About X-12",
                ].join("\n"),
                options: [
                    { label: "AFK", value: "AFK", description: MEANINGS.AFK },
                    {
                        label: "HITL",
                        value: "HITL",
                        description: `judged 0.80 · Needs review — ${MEANINGS.HITL}`,
                    },
                    { label: "grill-me", value: "grill-me", description: MEANINGS["grill-me"] },
                    { label: "Later", value: null, description: "Leave it for a later run" },
                ],
                multiSelect: false,
            },
        ]);
        expect(result.questions?.[0]?.options[1]?.description).toMatch(
            /^judged 0\.80 · Needs review — An agent may advance/,
        );
    });

    it("asks a scope with conflicting evidence, showing both pieces and prefixing no option", async () => {
        const settings = config();
        settings.sources.beads.scope = "personal";
        const result = await labelTriageStep.run(
            triageContext({
                config: settings,
                trackers: trackers([], { beads: [task("beads", "X-12", ["nazaries", "AFK"])] }),
                args: { apply: true },
            }),
        );
        expect(result.questions).toEqual([
            {
                id: "label-triage:beads:X-12:scope",
                step: "label-triage",
                header: "X-12",
                question: [
                    'beads X-12 "Task X-12": which scope label?',
                    "Seen: labels [nazaries, AFK] + written [proposal] → work, personal (code) → invalid under the contract: " +
                        "two scope labels: work, personal — conflicting evidence: alias nazaries; every beads task is personal",
                    "Description: About X-12",
                ].join("\n"),
                options: [
                    { label: "work", value: "work", description: MEANINGS.work },
                    { label: "personal", value: "personal", description: MEANINGS.personal },
                    { label: "Later", value: null, description: "Leave it for a later run" },
                ],
                multiSelect: false,
            },
        ]);
    });

    it("lists present labels in conflict for the human without asking a question for them", async () => {
        const result = await labelTriageStep.run(
            triageContext({
                trackers: trackers([], {
                    beads: [task("beads", "B-3", ["work", "personal", "AFK"])],
                }),
                args: { apply: true },
            }),
        );
        expect(result.data.conflicts.map((c) => [c.taskId, c.group])).toEqual([["B-3", "scope"]]);
        expect(result.reasons).toContain("1 group for the human");
        expect(result.questions).toEqual([]);
    });

    it("asks nothing for any task of a source whose writes stopped, still asking the others", async () => {
        const error = "linear issue update DOT-1 --label personal: linear failed";
        const result = await labelTriageStep.run(
            triageContext({
                trackers: trackers(
                    [],
                    {
                        beads: [task("beads", "X-12", ["nazaries"])],
                        linear: [task("linear", "DOT-1", []), task("linear", "DOT-2", [])],
                    },
                    { linear: { addLabelError: error } },
                ),
                judgement: judgeWith(UNSURE_HITL),
                args: { apply: true },
            }),
        );
        expect(result.data.failures.map((f) => [f.source, f.taskId])).toEqual([
            ["linear", "DOT-1"],
        ]);
        expect(
            result.data.records.filter((r) => r.status === "asked").map((r) => r.taskId),
        ).toEqual(["X-12", "DOT-1", "DOT-2"]);
        expect(result.questions?.map((q) => q.id)).toEqual(["label-triage:beads:X-12:autonomy"]);
    });

    it("asks a task with work evidence updated yesterday before a personal task updated today", async () => {
        const result = await labelTriageStep.run(
            triageContext({
                trackers: trackers([], {
                    beads: [
                        task("beads", "P-1", ["personal"], { updatedAt: "2026-09-23T09:00:00Z" }),
                        task("beads", "W-1", ["nazaries"], { updatedAt: "2026-09-22T09:00:00Z" }),
                    ],
                }),
                judgement: judgeWith(UNSURE_HITL),
                args: { apply: true },
            }),
        );
        expect(result.questions?.map((q) => q.id)).toEqual([
            "label-triage:beads:W-1:autonomy",
            "label-triage:beads:P-1:autonomy",
        ]);
    });

    it("asks a task's scope before its autonomy", async () => {
        const result = await labelTriageStep.run(
            triageContext({
                trackers: trackers([], { github: [task("github", "owner/repo#12", [])] }),
                judgement: judgeWith({
                    scope: { labels: ["work"], confidence: 0.6, reason: "Looks like work" },
                    ...UNSURE_HITL,
                }),
                args: { apply: true },
            }),
        );
        expect(result.questions?.map((q) => [q.id, q.header])).toEqual([
            ["label-triage:github:owner/repo#12:scope", "scope"],
            ["label-triage:github:owner/repo#12:autonomy", "autonomy"],
        ]);
        expect(result.questions?.[0]?.options.map((o) => o.description)).toEqual([
            `judged 0.60 · Looks like work — ${MEANINGS.work}`,
            MEANINGS.personal,
            "Leave it for a later run",
        ]);
    });

    it("heads a question with a task id of at most 12 characters, and with the group otherwise", async () => {
        const result = await labelTriageStep.run(
            triageContext({
                trackers: trackers([], {
                    beads: [task("beads", "agentic-task-8v0", ["nazaries"])],
                    linear: [task("linear", "DOT-104", [])],
                }),
                judgement: judgeWith(UNSURE_HITL),
                args: { apply: true },
            }),
        );
        expect(result.questions?.map((q) => [q.id, q.header])).toEqual([
            ["label-triage:beads:agentic-task-8v0:autonomy", "autonomy"],
            ["label-triage:linear:DOT-104:autonomy", "DOT-104"],
        ]);
    });

    it("quotes the description readTask returned for a Linear task listed without one", async () => {
        const result = await labelTriageStep.run(
            triageContext({
                trackers: trackers(
                    [],
                    { linear: [task("linear", "DOT-2", [])] },
                    { linear: { descriptions: { "DOT-2": "Refine the plan with me" } } },
                ),
                judgement: judgeWith(UNSURE_HITL),
                args: { apply: true },
            }),
        );
        expect(result.questions?.map((q) => q.question)).toEqual([
            [
                'linear DOT-2 "Task DOT-2": which autonomy label?',
                "Seen: labels [] + written [personal] → HITL (llm, 0.80) → below threshold 0.95: 0.80 — Needs review",
                "Description: Refine the plan with me",
            ].join("\n"),
        ]);
    });

    it("asks nothing for a task whose judgement failed or whose description could not be read", async () => {
        const failed = await labelTriageStep.run(
            triageContext({
                trackers: trackers([], { beads: [task("beads", "X-12", ["nazaries"])] }),
                judgement: fakeJudgement(() => ({
                    ok: false,
                    error: "claude timed out after 300 s",
                })),
                args: { apply: true },
            }),
        );
        expect(failed.data.notJudged.map((n) => n.taskId)).toEqual(["X-12"]);
        expect(failed.questions).toEqual([]);

        const unreadable = await labelTriageStep.run(
            triageContext({
                trackers: trackers(
                    [],
                    { linear: [task("linear", "DOT-2", [])] },
                    {
                        linear: {
                            readErrors: { "DOT-2": "linear issue view DOT-2 --json: timed out" },
                        },
                    },
                ),
                judgement: judgeWith(UNSURE_HITL),
                args: { apply: true },
            }),
        );
        expect(unreadable.data.notJudged.map((n) => n.taskId)).toEqual(["DOT-2"]);
        expect(unreadable.questions).toEqual([]);
    });

    it("asks nothing for a task beyond the cap", async () => {
        const settings = config();
        settings.judgement.cap = 1;
        const result = await labelTriageStep.run(
            triageContext({
                config: settings,
                trackers: trackers([], {
                    beads: [
                        task("beads", "W-1", ["nazaries"]),
                        task("beads", "W-2", ["nazaries"], { updatedAt: "2026-09-19T10:00:00Z" }),
                    ],
                }),
                judgement: judgeWith(UNSURE_HITL),
                args: { apply: true },
            }),
        );
        expect(result.data.remainder).toBe(1);
        expect(result.questions?.map((q) => q.id)).toEqual(["label-triage:beads:W-1:autonomy"]);
    });
});

describe("label triage: the stage follows the autonomy", () => {
    it("Stage by rule: proposal for a task carrying work and AFK, with confidence 1, tier code and a reason naming AFK", async () => {
        const judgement = judgeAll();
        const result = await labelTriageStep.run(
            triageContext({
                trackers: trackers([], { beads: [task("beads", "B-1", ["work", "AFK"])] }),
                judgement,
            }),
        );
        expect(judgement.requests).toEqual([]);
        expect(result.data.records).toEqual([
            {
                source: "beads",
                taskId: "B-1",
                title: "Task B-1",
                group: "stage",
                labels: ["proposal"],
                confidence: 1,
                reason: "autonomy AFK is present",
                tier: "code",
                status: "proposed",
                detail: null,
            },
        ]);
    });

    it("Stage after a rule-derived autonomy: HITL and proposal both derived with confidence 1", async () => {
        const settings = config();
        settings.sources.beads.aliases = { work: ["nazaries"], HITL: ["human"] };
        const judgement = judgeAll();
        const result = await labelTriageStep.run(
            triageContext({
                config: settings,
                trackers: trackers([], { beads: [task("beads", "B-1", ["work", "human"])] }),
                judgement,
            }),
        );
        expect(judgement.requests).toEqual([]);
        expect(
            result.data.records.map((r) => [r.group, r.labels, r.confidence, r.tier, r.reason]),
        ).toEqual([
            ["autonomy", ["HITL"], 1, "code", "alias human"],
            ["stage", ["proposal"], 1, "code", "follows autonomy HITL"],
        ]);
    });

    it("Grill decided by judgement: grill-me is eligible, with no autonomy label and no proposal", async () => {
        const calls: string[] = [];
        const result = await labelTriageStep.run(
            triageContext({
                trackers: trackers(calls, { beads: [task("beads", "B-1", ["personal"])] }),
                judgement: judgeWith({
                    autonomy: { labels: ["grill-me"], confidence: 0.97, reason: "Needs a grill" },
                }),
                args: { apply: true },
            }),
        );
        expect(result.data.records).toEqual([
            {
                source: "beads",
                taskId: "B-1",
                title: "Task B-1",
                group: "stage",
                labels: ["grill-me"],
                confidence: 0.97,
                reason: "Needs a grill",
                tier: "llm",
                status: "applied",
                detail: null,
            },
        ]);
        expect(calls.filter((call) => call.includes("addLabel"))).toEqual([
            "beads:addLabel:B-1:grill-me",
        ]);
    });

    it("Autonomy left for the human: neither AFK nor proposal is written, and the autonomy is asked", async () => {
        const calls: string[] = [];
        const result = await labelTriageStep.run(
            triageContext({
                trackers: trackers(calls, { beads: [task("beads", "B-1", ["personal"])] }),
                judgement: judgeWith({
                    autonomy: { labels: ["AFK"], confidence: 0.8, reason: "Looks routine" },
                }),
                args: { apply: true },
            }),
        );
        expect(result.data.records.map((r) => [r.group, r.labels, r.status])).toEqual([
            ["autonomy", ["AFK"], "asked"],
        ]);
        expect(calls.filter((call) => call.includes("addLabel"))).toEqual([]);
        expect(result.questions?.map((q) => q.id)).toEqual(["label-triage:beads:B-1:autonomy"]);
    });
});

describe("label triage: the autonomy decision depends on the stage", () => {
    it("Task with neither: its autonomy decision may be AFK, HITL or grill-me", async () => {
        const judgement = judgeWith(UNSURE_HITL);
        const result = await labelTriageStep.run(
            triageContext({
                trackers: trackers([], { beads: [task("beads", "B-1", ["personal"])] }),
                judgement,
                args: { apply: true },
            }),
        );
        expect(judgement.requests.map((r) => r.tasks.map((t) => [t.id, t.groups]))).toEqual([
            [["B-1", ["autonomy"]]],
        ]);
        expect(result.questions?.[0]?.options.map((o) => o.label)).toEqual([
            "AFK",
            "HITL",
            "grill-me",
            "Later",
        ]);
    });

    it("Task in grill-me: no autonomy decision is requested", async () => {
        const judgement = judgeAll();
        const result = await labelTriageStep.run(
            triageContext({
                trackers: trackers([], { beads: [task("beads", "B-1", ["personal", "grill-me"])] }),
                judgement,
                args: { apply: true },
            }),
        );
        expect(judgement.requests).toEqual([]);
        expect(result.data.records).toEqual([]);
        expect(result.questions).toEqual([]);
    });
});

describe("label triage: confidence threshold per group", () => {
    it("Grill judged for a task in proposal: the autonomy is asked as invalid, not written", async () => {
        const calls: string[] = [];
        const result = await labelTriageStep.run(
            triageContext({
                trackers: trackers(calls, {
                    beads: [task("beads", "B-1", ["personal", "proposal"])],
                }),
                judgement: judgeWith({
                    autonomy: { labels: ["grill-me"], confidence: 0.99, reason: "Unclear" },
                }),
                args: { apply: true },
            }),
        );
        expect(result.data.records).toEqual([
            {
                source: "beads",
                taskId: "B-1",
                title: "Task B-1",
                group: "autonomy",
                labels: ["grill-me"],
                confidence: 0.99,
                reason: "Unclear",
                tier: "llm",
                status: "asked",
                detail: "invalid under the contract: grill-me with a stage label: proposal",
            },
        ]);
        expect(calls.filter((call) => call.includes("addLabel"))).toEqual([]);
        expect(result.questions?.[0]?.options.map((o) => o.label)).toEqual([
            "AFK",
            "HITL",
            "Later",
        ]);
    });

    it("Invalid judgement: AFK and HITL at 0.99 are asked as a conflict, not written", async () => {
        const result = await labelTriageStep.run(
            triageContext({
                trackers: trackers([], { beads: [task("beads", "B-1", ["personal"])] }),
                judgement: judgeWith({
                    autonomy: { labels: ["AFK", "HITL"], confidence: 0.99, reason: "Both" },
                }),
                args: { apply: true },
            }),
        );
        expect(result.data.records.map((r) => [r.group, r.status, r.detail])).toEqual([
            ["autonomy", "asked", "invalid under the contract: AFK with HITL"],
        ]);
    });
});

describe("label triage: detect missing groups and conflicts per task", () => {
    it("Legacy label only: missing scope, autonomy and stage, with nazaries as evidence for work", async () => {
        const result = await labelTriageStep.run(
            triageContext({
                trackers: trackers([], { beads: [task("beads", "B-1", ["nazaries"])] }),
                judgement: fakeJudgement(() => ({ ok: false, error: "not now" })),
            }),
        );
        expect(result.data.sources[0]).toEqual({
            source: "beads",
            read: 1,
            complete: 0,
            missing: { scope: 1, autonomy: 1, stage: 1 },
            conflict: { scope: 0, autonomy: 0, stage: 0 },
        });
        expect(result.data.records.map((r) => [r.group, r.labels, r.reason])).toEqual([
            ["scope", ["work"], "alias nazaries"],
        ]);
    });

    it.each([
        ["Complete task", ["personal", "HITL", "proposal"]],
        ["Grill without autonomy", ["personal", "grill-me"]],
    ])("%s: not listed as untagged", async (_, labels) => {
        const result = await labelTriageStep.run(
            triageContext({ trackers: trackers([], { beads: [task("beads", "B-1", labels)] }) }),
        );
        expect(result.data.sources[0]).toEqual({
            source: "beads",
            read: 1,
            complete: 1,
            missing: { scope: 0, autonomy: 0, stage: 0 },
            conflict: { scope: 0, autonomy: 0, stage: 0 },
        });
        expect(result.data.records).toEqual([]);
        expect(result.data.conflicts).toEqual([]);
    });

    it("keys the data by scope, autonomy and stage, with no entry key", async () => {
        const result = await labelTriageStep.run(
            triageContext({
                trackers: trackers([], { beads: [task("beads", "B-1", ["work", "AFK"])] }),
            }),
        );
        const data = JSON.stringify(result.data);
        expect(Object.keys(result.data.sources[0]?.missing ?? {})).toEqual([
            "scope",
            "autonomy",
            "stage",
        ]);
        expect(data).not.toContain('"entry"');
    });
});

describe("label triage: labels missing on a tracker are not written", () => {
    it("proposal not bootstrapped on Linear: proposed with the bootstrap hint, the other Linear writes still happen", async () => {
        const calls: string[] = [];
        const labels = ["personal", "AFK", "HITL"].map((name) => ({
            scope: "workspace",
            name,
            colour: "#000000",
        }));
        const result = await labelTriageStep.run(
            triageContext({
                trackers: trackers(
                    calls,
                    {
                        linear: [
                            task("linear", "DOT-1", ["personal", "HITL"]),
                            task("linear", "DOT-2", ["AFK", "proposal"]),
                        ],
                    },
                    { linear: { createsLabels: true, labels } },
                ),
                args: { apply: true },
            }),
        );
        const detail = "proposal is missing on linear; run --bootstrap-labels";
        expect(result.data.records.map((r) => [r.taskId, r.labels, r.status, r.detail])).toEqual([
            ["DOT-1", ["proposal"], "proposed", detail],
            ["DOT-2", ["personal"], "applied", null],
        ]);
        expect(result.data.failures).toEqual([]);
        expect(calls.filter((call) => !call.includes("readTask"))).toEqual([
            "beads:listTasks",
            "github:listTasks",
            "linear:listTasks",
            "linear:listLabels",
            "linear:addLabel:DOT-2:personal",
        ]);
        expect(result.reasons).toEqual([
            "beads: 0 read, 0 complete, 0 missing scope, 0 missing autonomy, 0 missing stage, 0 in conflict",
            "github: 0 read, 0 complete, 0 missing scope, 0 missing autonomy, 0 missing stage, 0 in conflict",
            "linear: 2 read, 0 complete, 1 missing scope, 0 missing autonomy, 1 missing stage, 0 in conflict",
            "applied 1 label",
            "proposed 1 label",
            detail,
        ]);
    });

    it("a run without --apply reports the label Linear lacks, proposed with the bootstrap hint, and writes nothing", async () => {
        const calls: string[] = [];
        const labels = ["personal", "AFK", "HITL"].map((name) => ({
            scope: "workspace",
            name,
            colour: "#000000",
        }));
        const result = await labelTriageStep.run(
            triageContext({
                trackers: trackers(
                    calls,
                    {
                        linear: [
                            task("linear", "DOT-1", ["personal", "HITL"]),
                            task("linear", "DOT-2", ["AFK", "proposal"]),
                        ],
                    },
                    { linear: { createsLabels: true, labels } },
                ),
            }),
        );
        const detail = "proposal is missing on linear; run --bootstrap-labels";
        expect(result.data.records.map((r) => [r.taskId, r.labels, r.status, r.detail])).toEqual([
            ["DOT-1", ["proposal"], "proposed", detail],
            ["DOT-2", ["personal"], "proposed", null],
        ]);
        expect(result.data.failures).toEqual([]);
        expect(calls).toEqual([
            "beads:listTasks",
            "github:listTasks",
            "linear:listTasks",
            "linear:listLabels",
        ]);
        expect(result.reasons).toEqual([
            "beads: 0 read, 0 complete, 0 missing scope, 0 missing autonomy, 0 missing stage, 0 in conflict",
            "github: 0 read, 0 complete, 0 missing scope, 0 missing autonomy, 0 missing stage, 0 in conflict",
            "linear: 2 read, 0 complete, 1 missing scope, 0 missing autonomy, 1 missing stage, 0 in conflict",
            "proposed 2 labels",
            detail,
        ]);
    });

    it("a run without --apply whose label listing fails still proposes, with one reason and no failure", async () => {
        const calls: string[] = [];
        const error = "linear label list --all --json: Linear CLI is not authenticated";
        const result = await labelTriageStep.run(
            triageContext({
                trackers: trackers(
                    calls,
                    { linear: [task("linear", "DOT-1", ["personal", "HITL"])] },
                    { linear: { createsLabels: true, labels: error } },
                ),
            }),
        );
        expect(result.outcome).toBe("advance");
        expect(result.data.records.map((r) => [r.taskId, r.labels, r.status, r.detail])).toEqual([
            ["DOT-1", ["proposal"], "proposed", null],
        ]);
        expect(result.data.failures).toEqual([]);
        expect(result.reasons).toContain(`labels on linear could not be listed: ${error}`);
        expect(calls.filter((call) => call.includes("addLabel"))).toEqual([]);
    });

    it("Beads: proposal is written without any check", async () => {
        const calls: string[] = [];
        const result = await labelTriageStep.run(
            triageContext({
                trackers: trackers(calls, { beads: [task("beads", "B-1", ["work", "AFK"])] }),
                args: { apply: true },
            }),
        );
        expect(result.data.records.map((r) => [r.labels, r.status])).toEqual([
            [["proposal"], "applied"],
        ]);
        expect(calls).toEqual([
            "beads:listTasks",
            "github:listTasks",
            "linear:listTasks",
            "beads:addLabel:B-1:proposal",
            "beads:readTask:B-1",
        ]);
    });
});
