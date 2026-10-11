import { describe, expect, it } from "vitest";

import type { AutonomousConfig } from "../config.ts";
import type { LabelTriageData } from "../label-triage/step.ts";
import { config } from "../label-triage/test-fixtures.ts";
import { exitCodeFor } from "../report.ts";
import type { StepResult } from "../runner.ts";
import { selectStep } from "./step.ts";
import {
    fakeChezmoi,
    fakeReader,
    fakeSelection,
    selectContext,
    workTask,
} from "./test-fixtures.ts";
import type { SelectData } from "./types.ts";

const EMPTY: SelectData = {
    machineScope: null,
    selected: null,
    candidates: [],
    excluded: [],
    notEvaluated: [],
    comparison: null,
};

const GITHUB_NOTE = ["github: dependencies and children"];

const withoutGithub = (): AutonomousConfig => {
    const settings = config();
    return { ...settings, sources: { ...settings.sources, github: { enabled: false, repos: [] } } };
};

// Two in-scope grill-me candidates, one per source; the LLM picks DOT-120.
function twoCandidates(calls: string[]) {
    return [
        fakeReader("beads", [workTask("beads", "B-7", ["personal", "grill-me"])], calls),
        fakeReader(
            "linear",
            [workTask("linear", "DOT-120", ["personal", "HITL", "grill-me"])],
            calls,
        ),
    ];
}

const pickDot120 = () =>
    fakeSelection(() => ({
        ok: true,
        answer: {
            source: "linear",
            id: "DOT-120",
            explanation: "It unblocks two tasks.",
            exception: null,
        },
    }));

describe("select: the machine scope", () => {
    it("reads a personal machine scope before any reader and carries it in the data", async () => {
        const calls: string[] = [];
        const result = await selectStep.run(
            selectContext({
                calls,
                readers: [fakeReader("linear", [workTask("linear", "DOT-1")], calls)],
            }),
        );
        expect(result.data.machineScope).toBe("personal");
        expect(calls.slice(0, 2)).toEqual(["chezmoi data --format json", "work"]);
    });

    it("is not evaluable naming chezmoi data and machineType when the value is missing", async () => {
        const calls: string[] = [];
        const result = await selectStep.run(
            selectContext({
                calls,
                chezmoi: fakeChezmoi({ name: "me" }, calls),
                readers: [fakeReader("linear", [workTask("linear", "DOT-1")], calls)],
            }),
        );
        expect(result).toEqual({
            step: "select",
            tier: "code",
            outcome: "not-evaluable",
            reasons: ["chezmoi data: output.machineType is missing"],
            data: EMPTY,
        });
    });

    it("calls no reader when the machine scope fails", async () => {
        const calls: string[] = [];
        const result = await selectStep.run(
            selectContext({
                calls,
                chezmoi: fakeChezmoi("chezmoi CLI not found on PATH", calls),
                readers: [fakeReader("linear", [workTask("linear", "DOT-1")], calls)],
            }),
        );
        expect(result.outcome).toBe("not-evaluable");
        expect(result.reasons).toEqual(["chezmoi data: chezmoi CLI not found on PATH"]);
        expect(calls).toEqual(["chezmoi data --format json"]);
    });

    it("is not evaluable with the configuration error, reading nothing", async () => {
        const calls: string[] = [];
        const result = await selectStep.run(
            selectContext({
                calls,
                config: { ok: false, path: "/home/me/config.json", error: "no configuration" },
                readers: [],
            }),
        );
        expect(result).toEqual({
            step: "select",
            tier: "code",
            outcome: "not-evaluable",
            reasons: ["no configuration"],
            data: EMPTY,
        });
        expect(calls).toEqual([]);
    });
});

describe("select: reading the tasks again", () => {
    it("is not evaluable naming Linear and the command when linear issue view fails", async () => {
        const calls: string[] = [];
        const result = await selectStep.run(
            selectContext({
                calls,
                readers: [
                    fakeReader("linear", [workTask("linear", "DOT-1")], calls, {
                        detailErrors: { "DOT-1": "linear issue view DOT-1: linear failed: boom" },
                    }),
                ],
            }),
        );
        expect(result).toEqual({
            step: "select",
            tier: "code",
            outcome: "not-evaluable",
            reasons: ["linear: linear issue view DOT-1: linear failed: boom"],
            data: { ...EMPTY, machineScope: "personal", notEvaluated: GITHUB_NOTE },
        });
    });

    it("is not evaluable naming the source and the command when a listing fails, listing no later source", async () => {
        const calls: string[] = [];
        const result = await selectStep.run(
            selectContext({
                calls,
                readers: [
                    fakeReader("beads", "bd list --json: bd CLI not found on PATH", calls),
                    fakeReader("linear", [workTask("linear", "DOT-1")], calls),
                ],
            }),
        );
        expect(result.outcome).toBe("not-evaluable");
        expect(result.reasons).toEqual(["beads: bd list --json: bd CLI not found on PATH"]);
        expect(calls).not.toContain("linear:list");
    });

    it("details each surviving task through the reader of its own source", async () => {
        const calls: string[] = [];
        await selectStep.run(
            selectContext({ calls, readers: twoCandidates(calls), selection: pickDot120() }),
        );
        expect(calls.filter((call) => call.includes(":detail:"))).toEqual([
            "beads:detail:B-7",
            "linear:detail:DOT-120",
        ]);
    });

    it("excludes a task label-triage applied a label to in this run", async () => {
        const calls: string[] = [];
        const triage: StepResult<Pick<LabelTriageData, "records">> = {
            step: "label-triage",
            tier: "code",
            outcome: "advance",
            reasons: [],
            data: {
                records: [
                    {
                        source: "linear",
                        taskId: "DOT-120",
                        title: "Task DOT-120",
                        group: "entry",
                        labels: ["grill-me"],
                        confidence: 1,
                        reason: "rule",
                        tier: "code",
                        status: "applied",
                        detail: null,
                    },
                ],
            },
        };
        const result = await selectStep.run(
            selectContext({ calls, readers: twoCandidates(calls), results: [triage] }),
        );
        expect(result.outcome).toBe("advance");
        expect(result.data.selected?.id).toBe("B-7");
        expect(result.data.excluded).toEqual([
            {
                source: "linear",
                id: "DOT-120",
                title: "Task DOT-120",
                reason: "labelled-this-run",
            },
        ]);
    });
});

describe("select: outcome", () => {
    it("waits with exit 2 and a count per reason when three are unsupported and one is taken", async () => {
        const calls: string[] = [];
        const result = await selectStep.run(
            selectContext({
                calls,
                readers: [
                    fakeReader(
                        "beads",
                        ["B-1", "B-2", "B-3"].map((id) =>
                            workTask("beads", id, ["personal", "AFK"]),
                        ),
                        calls,
                    ),
                    fakeReader(
                        "linear",
                        [workTask("linear", "DOT-4", ["personal", "grill-me", "taken"])],
                        calls,
                    ),
                ],
            }),
        );
        expect(result.outcome).toBe("wait");
        expect(result.tier).toBe("code");
        expect(result.reasons).toEqual(["1 taken", "3 unsupported stage"]);
        expect(exitCodeFor(result.outcome)).toBe(2);
        expect(calls.filter((call) => call.includes(":detail:"))).toEqual([]);
    });

    it("waits when no source has an open task", async () => {
        const calls: string[] = [];
        const result = await selectStep.run(
            selectContext({ calls, readers: [fakeReader("beads", [], calls)] }),
        );
        expect(result.outcome).toBe("wait");
        expect(result.reasons).toEqual(["no open task"]);
    });

    it("advances on a single candidate by code, calling no LLM", async () => {
        const calls: string[] = [];
        const selection = fakeSelection(() => ({ ok: false, error: "not expected" }));
        const result = await selectStep.run(
            selectContext({
                calls,
                readers: [fakeReader("linear", [workTask("linear", "DOT-1")], calls)],
                selection,
            }),
        );
        expect(result.outcome).toBe("advance");
        expect(result.tier).toBe("code");
        expect(result.reasons).toEqual(["selected linear → DOT-1 for grill-me, from 1 candidate"]);
        expect(result.data.selected).toMatchObject({
            id: "DOT-1",
            explanation: "It was the only candidate.",
        });
        expect(result.data.comparison).toBeNull();
        expect(selection.requests).toEqual([]);
    });

    it("advances on two candidates through one LLM call with the configured model and effort", async () => {
        const calls: string[] = [];
        const selection = pickDot120();
        const result = await selectStep.run(
            selectContext({ calls, readers: twoCandidates(calls), selection }),
        );
        expect(result.outcome).toBe("advance");
        expect(result.tier).toBe("llm");
        expect(selection.requests).toHaveLength(1);
        expect(selection.requests[0]).toMatchObject({
            model: "sonnet",
            effort: "high",
            machineScope: "personal",
        });
        expect(result.data.comparison).toEqual({ model: "sonnet", effort: "high" });
        expect(result.data.selected).toEqual({
            source: "linear",
            id: "DOT-120",
            title: "Task DOT-120",
            stage: "grill-me",
            autonomy: "HITL",
            scope: "personal",
            explanation: "It unblocks two tasks.",
            exception: null,
        });
    });

    it.each([
        ["the LLM fails", { ok: false as const, error: "claude timed out after 300 s" }],
        [
            "its answer is not a candidate",
            {
                ok: true as const,
                answer: {
                    source: "linear" as const,
                    id: "DOT-999",
                    explanation: "Made up.",
                    exception: null,
                },
            },
        ],
    ])("is not evaluable with no fallback when %s", async (_, answer) => {
        const calls: string[] = [];
        const result = await selectStep.run(
            selectContext({
                calls,
                readers: twoCandidates(calls),
                selection: fakeSelection(() => answer),
            }),
        );
        expect(result.outcome).toBe("not-evaluable");
        expect(result.tier).toBe("llm");
        expect(result.reasons).toHaveLength(1);
        expect(result.data.selected).toBeNull();
        expect(result.data.comparison).toEqual({ model: "sonnet", effort: "high" });
    });

    it("writes nothing and returns no questions when run with --apply", async () => {
        const calls: string[] = [];
        const result = await selectStep.run(
            selectContext({
                calls,
                readers: twoCandidates(calls),
                selection: pickDot120(),
                args: { apply: true },
            }),
        );
        expect(result.outcome).toBe("advance");
        expect(result).not.toHaveProperty("questions");
        // No tracker is touched: only chezmoi and the read-only work readers.
        expect(calls).toEqual([
            "chezmoi data --format json",
            "work",
            "beads:list",
            "linear:list",
            "beads:detail:B-7",
            "linear:detail:DOT-120",
        ]);
    });
});

describe("select: JSON data", () => {
    it("lists every excluded task with its source, id, title and reason, and the GitHub note", async () => {
        const calls: string[] = [];
        const result = await selectStep.run(
            selectContext({
                calls,
                readers: [
                    fakeReader(
                        "beads",
                        [
                            workTask("beads", "B-1", ["grill-me"]),
                            workTask("beads", "B-2", ["work", "grill-me"], { blockedBy: ["B-9"] }),
                        ],
                        calls,
                    ),
                    fakeReader(
                        "linear",
                        [
                            workTask("linear", "DOT-3", ["personal", "grill-me"]),
                            workTask("linear", "DOT-4", ["personal", "grill-me"]),
                        ],
                        calls,
                        { details: { "DOT-4": { children: ["DOT-5"] } } },
                    ),
                ],
                args: { json: true },
            }),
        );
        const data = JSON.parse(JSON.stringify(result.data)) as SelectData;
        expect(data).toEqual({
            machineScope: "personal",
            selected: {
                source: "linear",
                id: "DOT-3",
                title: "Task DOT-3",
                stage: "grill-me",
                autonomy: "grill-me",
                scope: "personal",
                explanation: "It was the only candidate.",
                exception: null,
            },
            candidates: [
                {
                    source: "linear",
                    id: "DOT-3",
                    title: "Task DOT-3",
                    scope: "personal",
                    stage: "grill-me",
                },
            ],
            excluded: [
                { source: "beads", id: "B-1", title: "Task B-1", reason: "classification" },
                { source: "beads", id: "B-2", title: "Task B-2", reason: "blocked" },
                { source: "linear", id: "DOT-4", title: "Task DOT-4", reason: "split" },
            ],
            notEvaluated: GITHUB_NOTE,
            comparison: null,
        });
    });

    it("leaves the GitHub note out when GitHub is disabled", async () => {
        const calls: string[] = [];
        const result = await selectStep.run(
            selectContext({
                calls,
                config: withoutGithub(),
                readers: [fakeReader("linear", [workTask("linear", "DOT-1")], calls)],
            }),
        );
        expect(result.data.notEvaluated).toEqual([]);
    });
});
