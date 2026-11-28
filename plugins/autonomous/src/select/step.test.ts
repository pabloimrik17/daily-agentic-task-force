import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { writeRecord } from "../attempts/state.ts";
import { record } from "../attempts/test-fixtures.ts";
import type { AutonomousConfig } from "../config.ts";
import type { LabelTriageData } from "../label-triage/step.ts";
import { config } from "../label-triage/test-fixtures.ts";
import { appendStuck, UNREAD_ONCE } from "../loop/files.ts";
import { exitCodeFor } from "../report.ts";
import type { StepResult } from "../runner.ts";
import { grillMeStage } from "../stages/grill-me/stage.ts";
import { implementStage } from "../stages/implement/stage.ts";
import { proposalStage } from "../stages/proposal/stage.ts";
import type { Stage } from "../stages/stage.ts";
import { selectStep } from "./step.ts";
import {
    fakeChezmoi,
    locatedReader,
    fakeSelection,
    selectContext,
    workTask,
    holdPrerequisites,
    selectWorkspace,
    type SelectWorkspace,
    fakeReader,
    REPOSITORY,
} from "./test-fixtures.ts";

let workspace: SelectWorkspace;

beforeEach(() => {
    workspace = selectWorkspace();
    holdPrerequisites();
});

afterEach(async () => {
    vi.restoreAllMocks();
    await workspace.remove();
});
import type { SelectData } from "./types.ts";

const EMPTY: SelectData = {
    machineScope: null,
    selected: null,
    candidates: [],
    setAside: [],
    excluded: [],
    readyToClose: [],
    notEvaluated: [],
    comparison: null,
    unreadable: null,
};

const GITHUB_NOTE = ["github: dependencies"];

const withoutGithub = (): AutonomousConfig => {
    const settings = config();
    return { ...settings, sources: { ...settings.sources, github: { enabled: false, repos: [] } } };
};

// Two in-scope grill-me candidates, one per source; the LLM picks DOT-120.
function twoCandidates(calls: string[]) {
    return [
        locatedReader("beads", [workTask("beads", "B-7", ["personal", "grill-me"])], calls),
        locatedReader(
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
                workspace,
                calls,
                readers: [locatedReader("linear", [workTask("linear", "DOT-1")], calls)],
            }),
        );
        expect(result.data.machineScope).toBe("personal");
        expect(calls.slice(0, 2)).toEqual(["chezmoi data --format json", "work"]);
    });

    it("is not evaluable naming chezmoi data and machineType when the value is missing", async () => {
        const calls: string[] = [];
        const result = await selectStep.run(
            selectContext({
                workspace,
                calls,
                chezmoi: fakeChezmoi({ name: "me" }, calls),
                readers: [locatedReader("linear", [workTask("linear", "DOT-1")], calls)],
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
                workspace,
                calls,
                chezmoi: fakeChezmoi("chezmoi CLI not found on PATH", calls),
                readers: [locatedReader("linear", [workTask("linear", "DOT-1")], calls)],
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
                workspace,
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
                workspace,
                calls,
                readers: [
                    locatedReader("linear", [workTask("linear", "DOT-1")], calls, {
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
                workspace,
                calls,
                readers: [
                    locatedReader("beads", "bd list --json: bd CLI not found on PATH", calls),
                    locatedReader("linear", [workTask("linear", "DOT-1")], calls),
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
            selectContext({
                workspace,
                calls,
                readers: twoCandidates(calls),
                selection: pickDot120(),
            }),
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
                        group: "stage",
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
            selectContext({ workspace, calls, readers: twoCandidates(calls), results: [triage] }),
        );
        expect(result.outcome).toBe("advance");
        expect(result.data.selected?.id).toBe("B-7");
        expect(result.data.excluded).toEqual([
            {
                source: "linear",
                id: "DOT-120",
                title: "Task DOT-120",
                reason: "labelled-this-run",
                detail: null,
                stuck: false,
                scope: "personal",
            },
        ]);
    });
});

describe("select: outcome", () => {
    it("waits with exit 2 and a count per reason when three are unsupported and one is taken", async () => {
        const calls: string[] = [];
        const result = await selectStep.run(
            selectContext({
                workspace,
                calls,
                readers: [
                    locatedReader(
                        "beads",
                        ["B-1", "B-2", "B-3"].map((id) =>
                            workTask("beads", id, ["personal", "AFK", "external-review"]),
                        ),
                        calls,
                    ),
                    locatedReader(
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
            selectContext({ workspace, calls, readers: [locatedReader("beads", [], calls)] }),
        );
        expect(result.outcome).toBe("wait");
        expect(result.reasons).toEqual(["no open task"]);
    });

    it("advances on a single candidate by code, calling no LLM", async () => {
        const calls: string[] = [];
        const selection = fakeSelection(() => ({ ok: false, error: "not expected" }));
        const result = await selectStep.run(
            selectContext({
                workspace,
                calls,
                readers: [locatedReader("linear", [workTask("linear", "DOT-1")], calls)],
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
            selectContext({ workspace, calls, readers: twoCandidates(calls), selection }),
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
                workspace,
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
                workspace,
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
                workspace,
                calls,
                readers: [
                    locatedReader(
                        "beads",
                        [
                            workTask("beads", "B-1", ["grill-me"]),
                            workTask("beads", "B-2", ["work", "grill-me"], { blockedBy: ["B-9"] }),
                        ],
                        calls,
                    ),
                    locatedReader(
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
                autonomy: null,
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
            setAside: [],
            excluded: [
                {
                    source: "beads",
                    id: "B-1",
                    title: "Task B-1",
                    reason: "classification",
                    detail: null,
                    stuck: false,
                    scope: null,
                },
                {
                    source: "beads",
                    id: "B-2",
                    title: "Task B-2",
                    reason: "blocked",
                    detail: null,
                    stuck: false,
                    scope: "work",
                },
                {
                    source: "linear",
                    id: "DOT-4",
                    title: "Task DOT-4",
                    reason: "split",
                    detail: null,
                    stuck: false,
                    scope: "personal",
                },
            ],
            readyToClose: [],
            notEvaluated: GITHUB_NOTE,
            comparison: null,
            unreadable: null,
        });
    });

    it("carries each split parent whose subtasks are all closed, and writes nothing for it", async () => {
        const calls: string[] = [];
        const result = await selectStep.run(
            selectContext({
                workspace,
                calls,
                readers: [
                    locatedReader(
                        "linear",
                        [
                            workTask("linear", "DOT-8", ["personal", "AFK", "proposal"]),
                            workTask("linear", "DOT-9", ["personal", "AFK", "proposal"]),
                        ],
                        calls,
                        {
                            details: {
                                "DOT-8": { children: [], childCount: 2 },
                                "DOT-9": { children: ["DOT-10"], childCount: 2 },
                            },
                        },
                    ),
                ],
                args: { json: true },
            }),
        );
        const data = JSON.parse(JSON.stringify(result.data)) as SelectData;
        expect(data.readyToClose).toEqual([{ source: "linear", id: "DOT-8", title: "Task DOT-8" }]);
        expect(data.excluded.map(({ id, reason }) => [id, reason])).toEqual([
            ["DOT-8", "split"],
            ["DOT-9", "split"],
        ]);
        expect(calls).toEqual([
            "chezmoi data --format json",
            "work",
            "linear:list",
            "linear:detail:DOT-8",
            "linear:detail:DOT-9",
        ]);
    });

    it("carries a null autonomy for a selected task in grill-me without one", async () => {
        const calls: string[] = [];
        const result = await selectStep.run(
            selectContext({
                workspace,
                calls,
                readers: [
                    locatedReader(
                        "linear",
                        [workTask("linear", "DOT-1", ["personal", "grill-me"])],
                        calls,
                    ),
                ],
                args: { json: true },
            }),
        );
        const data = JSON.parse(JSON.stringify(result.data)) as SelectData;
        expect(result.outcome).toBe("advance");
        expect(data.selected).toMatchObject({ id: "DOT-1", stage: "grill-me", autonomy: null });
        expect(JSON.stringify(result.data)).toContain('"autonomy":null');
    });

    it("leaves the GitHub note out when GitHub is disabled", async () => {
        const calls: string[] = [];
        const result = await selectStep.run(
            selectContext({
                workspace,
                calls,
                config: withoutGithub(),
                readers: [locatedReader("linear", [workTask("linear", "DOT-1")], calls)],
            }),
        );
        expect(result.data.notEvaluated).toEqual([]);
    });
});

const prerequisitesFailing = (stage: Stage, failing: readonly string[]) =>
    vi
        .spyOn(stage, "prerequisites")
        .mockImplementation(({ task }) =>
            Promise.resolve(
                failing.includes(task.id)
                    ? { ok: false, reason: `${task.id} lacks a skill` }
                    : { ok: true, context: {} },
            ),
        );

const UNREADABLE =
    "cannot read the plugin registry /home/me/.claude/plugins/installed_plugins.json";

const prerequisitesUnreadable = (ids: readonly string[]) =>
    vi
        .spyOn(grillMeStage, "prerequisites")
        .mockImplementation(({ task }) =>
            Promise.resolve(
                ids.includes(task.id)
                    ? { ok: false, reason: UNREADABLE, unreadable: true }
                    : { ok: true, context: {} },
            ),
        );

const UNREAD_DOT_120 = { source: "linear", id: "DOT-120", reason: UNREADABLE };

const prerequisitesExcluded = (source: "beads" | "linear", id: string) => ({
    source,
    id,
    title: `Task ${id}`,
    reason: "prerequisites",
    detail: `${id} lacks a skill`,
    stuck: true,
    scope: "personal",
});

describe("select: what launch would refuse", () => {
    it("Attempt records cannot be read: not evaluable with the read error, and no comparison", async () => {
        mkdirSync(join(workspace.state, "attempts", "broken"), { recursive: true });
        writeFileSync(join(workspace.state, "attempts", "broken", "record.json"), "{");
        const calls: string[] = [];
        const selection = pickDot120();
        const result = await selectStep.run(
            selectContext({ workspace, calls, readers: twoCandidates(calls), selection }),
        );

        expect(result.outcome).toBe("not-evaluable");
        expect(result.reasons).toEqual([expect.stringContaining("record.json") as string]);
        expect(selection.requests).toEqual([]);
    });

    it("excludes a task whose attempt is retained, read from the state directory", async () => {
        await writeRecord(
            workspace.state,
            record({
                id: "linear:DOT-120:grill-me:1",
                task: { source: "linear", id: "DOT-120", title: "Task DOT-120" },
                stage: "grill-me",
                state: "retained",
            }),
        );
        const calls: string[] = [];
        const result = await selectStep.run(
            selectContext({ workspace, calls, readers: twoCandidates(calls) }),
        );

        expect(result.data.selected).toMatchObject({ id: "B-7" });
        expect(result.data.excluded).toEqual([
            {
                source: "linear",
                id: "DOT-120",
                title: "Task DOT-120",
                reason: "open-attempt",
                detail: "attempt linear:DOT-120:grill-me:1 is retained",
                stuck: true,
                scope: "personal",
            },
        ]);
    });

    it("Workspace root cannot be read: not evaluable with that error", async () => {
        const calls: string[] = [];
        const missing = join(workspace.root, "missing");
        const result = await selectStep.run(
            selectContext({
                calls,
                config: { ...config(), workspace: { root: missing } },
                readers: twoCandidates(calls),
            }),
        );

        expect(result.outcome).toBe("not-evaluable");
        expect(result.reasons).toEqual([
            expect.stringMatching(
                new RegExp(`^workspace root ${missing} cannot be read: `),
            ) as string,
        ]);
    });

    it("No tracker write: three stuck tasks with --apply touch no tracker", async () => {
        const calls: string[] = [];
        const result = await selectStep.run(
            selectContext({
                calls,
                workspace,
                readers: [
                    fakeReader(
                        "beads",
                        ["B-1", "B-2", "B-3"].map((id) =>
                            workTask("beads", id, ["personal", "grill-me"]),
                        ),
                        calls,
                    ),
                ],
                args: { apply: true },
            }),
        );

        expect(result.outcome).toBe("wait");
        expect(result.data.excluded.map(({ reason, stuck }) => [reason, stuck])).toEqual([
            ["repository", true],
            ["repository", true],
            ["repository", true],
        ]);
        expect(result.reasons).toEqual(["3 repository"]);
        expect(calls.filter((call) => /addLabel|removeLabel/.test(call))).toEqual([]);
        expect(calls).toEqual([
            "chezmoi data --format json",
            "work",
            "beads:list",
            "beads:detail:B-1",
            "beads:detail:B-2",
            "beads:detail:B-3",
        ]);
    });
});

describe("select: the chosen task's prerequisites", () => {
    it("are checked as launch checks them: the task, its repository and the tool", async () => {
        const check = prerequisitesFailing(grillMeStage, []);
        const calls: string[] = [];
        await selectStep.run(
            selectContext({
                workspace,
                calls,
                readers: [locatedReader("linear", [workTask("linear", "DOT-1")], calls)],
            }),
        );

        expect(check).toHaveBeenCalledTimes(1);
        expect(check.mock.calls[0]![0]).toMatchObject({
            tool: "claude",
            task: { id: "DOT-1" },
            repository: join(workspace.root, REPOSITORY),
        });
    });

    it("Second choice launches: the first is excluded as prerequisites and the second selected", async () => {
        prerequisitesFailing(grillMeStage, ["DOT-120"]);
        const calls: string[] = [];
        const selection = pickDot120();
        const result = await selectStep.run(
            selectContext({ workspace, calls, readers: twoCandidates(calls), selection }),
        );

        expect(result.outcome).toBe("advance");
        expect(result.tier).toBe("llm");
        expect(result.data.selected).toMatchObject({ source: "beads", id: "B-7" });
        expect(result.data.excluded).toEqual([prerequisitesExcluded("linear", "DOT-120")]);
        expect(selection.requests).toHaveLength(1);
        expect(result.data.comparison).toEqual({ model: "sonnet", effort: "high" });
    });

    it("Less advanced stage after a failure: the choice is made between the two proposal candidates", async () => {
        prerequisitesFailing(implementStage, ["I-1"]);
        const calls: string[] = [];
        const selection = fakeSelection(() => ({
            ok: true,
            answer: { source: "linear", id: "P-2", explanation: "Sooner.", exception: null },
        }));
        const result = await selectStep.run(
            selectContext({
                workspace,
                calls,
                readers: [
                    locatedReader(
                        "linear",
                        [
                            workTask("linear", "P-1", ["personal", "AFK", "proposal"]),
                            workTask("linear", "I-1", ["personal", "AFK", "implement"]),
                            workTask("linear", "P-2", ["personal", "AFK", "proposal"]),
                        ],
                        calls,
                    ),
                ],
                selection,
            }),
        );

        expect(result.data.excluded).toEqual([prerequisitesExcluded("linear", "I-1")]);
        expect(selection.requests.map((r) => r.candidates.map((c) => c.task.id))).toEqual([
            ["P-1", "P-2"],
        ]);
        expect(result.data.selected).toMatchObject({ id: "P-2", stage: "proposal" });
    });

    it("Choices run out: four chosen tasks fail, no fifth choice, and the step waits", async () => {
        const ids = ["DOT-1", "DOT-2", "DOT-3", "DOT-4", "DOT-5"];
        prerequisitesFailing(grillMeStage, ids);
        const calls: string[] = [];
        const selection = fakeSelection(({ candidates }) => ({
            ok: true,
            answer: {
                source: "linear",
                id: candidates[0]!.task.id,
                explanation: "First.",
                exception: null,
            },
        }));
        const result = await selectStep.run(
            selectContext({
                workspace,
                calls,
                readers: [
                    locatedReader(
                        "linear",
                        ids.map((id) => workTask("linear", id)),
                        calls,
                    ),
                ],
                selection,
            }),
        );

        expect(selection.requests).toHaveLength(4);
        expect(result.data.excluded).toEqual(
            ids.slice(0, 4).map((id) => prerequisitesExcluded("linear", id)),
        );
        expect(result.data.selected).toBeNull();
        expect(result.data.candidates.map((c) => c.id)).toEqual(["DOT-5"]);
    });

    it("Every choice failed its prerequisites: waits, saying so, with the counts per reason, at the llm tier", async () => {
        const ids = ["DOT-1", "DOT-2", "DOT-3", "DOT-4", "DOT-5"];
        prerequisitesFailing(grillMeStage, ids);
        const calls: string[] = [];
        const selection = fakeSelection(({ candidates }) => ({
            ok: true,
            answer: {
                source: "linear",
                id: candidates[0]!.task.id,
                explanation: "First.",
                exception: null,
            },
        }));
        const result = await selectStep.run(
            selectContext({
                workspace,
                calls,
                readers: [
                    locatedReader(
                        "linear",
                        [
                            ...ids.map((id) => workTask("linear", id)),
                            workTask("linear", "T-1", ["personal", "grill-me", "taken"]),
                        ],
                        calls,
                    ),
                ],
                selection,
            }),
        );

        expect(result.outcome).toBe("wait");
        expect(result.tier).toBe("llm");
        expect(result.reasons).toEqual([
            "4 choices failed their prerequisites",
            "1 taken",
            "4 prerequisites",
        ]);
        expect(exitCodeFor(result.outcome)).toBe(2);
    });

    it("is not evaluable when a prerequisite cannot be read", async () => {
        vi.spyOn(grillMeStage, "prerequisites").mockRejectedValue(new Error("EACCES: home"));
        const calls: string[] = [];
        const result = await selectStep.run(
            selectContext({
                workspace,
                calls,
                readers: [locatedReader("linear", [workTask("linear", "DOT-1")], calls)],
            }),
        );

        expect(result.outcome).toBe("not-evaluable");
        expect(result.reasons).toEqual([
            "the grill-me prerequisites of linear:DOT-1 cannot be read: EACCES: home",
        ]);
        expect(result.data.selected).toBeNull();
    });

    it("Repository prerequisites cannot be read: not evaluable with the reason, nothing excluded", async () => {
        const reason = "the OpenSpec root /w/repo/openspec of /w/repo cannot be read: EIO";
        vi.spyOn(proposalStage, "repositoryPrerequisites").mockResolvedValue({
            ok: false,
            reason,
            unreadable: true,
        });
        const calls: string[] = [];
        const result = await selectStep.run(
            selectContext({
                workspace,
                calls,
                readers: [
                    locatedReader(
                        "linear",
                        [workTask("linear", "DOT-1", ["personal", "AFK", "proposal"])],
                        calls,
                    ),
                ],
            }),
        );

        expect(result.outcome).toBe("not-evaluable");
        expect(result.reasons).toEqual([reason]);
        expect(result.data.excluded).toEqual([]);
        expect(result.data.selected).toBeNull();
    });

    it("Prerequisites cannot be read: not evaluable with the reason, nothing excluded and no other choice", async () => {
        prerequisitesUnreadable(["DOT-120"]);
        const calls: string[] = [];
        const selection = pickDot120();
        const result = await selectStep.run(
            selectContext({ workspace, calls, readers: twoCandidates(calls), selection }),
        );

        expect(result.outcome).toBe("not-evaluable");
        expect(result.reasons).toEqual([UNREADABLE]);
        expect(result.data.excluded).toEqual([]);
        expect(result.data.selected).toBeNull();
        expect(result.data.unreadable).toEqual(UNREAD_DOT_120);
        expect(selection.requests).toHaveLength(1);
    });
});

describe("select: prerequisites that failed earlier in the loop", () => {
    const remember = (id: string) =>
        appendStuck(workspace.state, {
            task: `linear:${id}`,
            exclusion: "prerequisites",
            detail: `${id} lacks a skill`,
        });

    it("Still failing: excluded before the comparison, which is not given it", async () => {
        await remember("DOT-120");
        prerequisitesFailing(grillMeStage, ["DOT-120"]);
        const calls: string[] = [];
        const selection = pickDot120();
        const result = await selectStep.run(
            selectContext({
                workspace,
                calls,
                readers: twoCandidates(calls),
                selection,
                args: { loop: true },
            }),
        );

        expect(selection.requests).toEqual([]);
        expect(result.data.excluded).toEqual([prerequisitesExcluded("linear", "DOT-120")]);
        expect(result.data.selected).toMatchObject({ id: "B-7" });
        expect(result.tier).toBe("code");
    });

    it("Fixed since: the task is a candidate", async () => {
        await remember("DOT-120");
        const calls: string[] = [];
        const selection = pickDot120();
        const result = await selectStep.run(
            selectContext({
                workspace,
                calls,
                readers: twoCandidates(calls),
                selection,
                args: { loop: true },
            }),
        );

        expect(selection.requests[0]?.candidates.map((c) => c.task.id)).toEqual(["B-7", "DOT-120"]);
        expect(result.data.selected).toMatchObject({ id: "DOT-120" });
    });

    it("Cannot be read now: not evaluable with the reason, and no comparison", async () => {
        await remember("DOT-120");
        prerequisitesUnreadable(["DOT-120"]);
        const calls: string[] = [];
        const selection = pickDot120();
        const result = await selectStep.run(
            selectContext({
                workspace,
                calls,
                readers: twoCandidates(calls),
                selection,
                args: { loop: true },
            }),
        );

        expect(result.outcome).toBe("not-evaluable");
        expect(result.reasons).toEqual([UNREADABLE]);
        expect(result.data.excluded).toEqual([]);
        expect(result.data.unreadable).toEqual(UNREAD_DOT_120);
        expect(selection.requests).toEqual([]);
    });

    it("Manual run: the task reaches the comparison", async () => {
        await remember("DOT-120");
        prerequisitesFailing(grillMeStage, ["DOT-120"]);
        const calls: string[] = [];
        const selection = fakeSelection(() => ({
            ok: true,
            answer: { source: "beads", id: "B-7", explanation: "Sooner.", exception: null },
        }));
        await selectStep.run(
            selectContext({ workspace, calls, readers: twoCandidates(calls), selection }),
        );

        expect(selection.requests[0]?.candidates.map((c) => c.task.id)).toEqual(["B-7", "DOT-120"]);
    });
});

describe("select: prerequisites that could not be read earlier in the loop", () => {
    const remember = (exclusion: string) =>
        appendStuck(workspace.state, { task: "linear:DOT-120", exclusion, detail: UNREADABLE });
    const looping = (calls: string[], selection = pickDot120()) =>
        selectContext({
            workspace,
            calls,
            readers: twoCandidates(calls),
            selection,
            args: { loop: true },
        });
    const setAside = {
        source: "linear",
        id: "DOT-120",
        title: "Task DOT-120",
        reason: "unreadable-prerequisites",
        detail: UNREADABLE,
        stuck: true,
        scope: "personal",
    };

    it("Unreadable again: excluded before the comparison, and another task is selected", async () => {
        await remember(UNREAD_ONCE);
        prerequisitesUnreadable(["DOT-120"]);
        const selection = pickDot120();
        const result = await selectStep.run(looping([], selection));

        expect(result.outcome).toBe("advance");
        expect(selection.requests).toEqual([]);
        expect(result.data.excluded).toEqual([setAside]);
        expect(result.data.selected).toMatchObject({ id: "B-7" });
        expect(result.data.unreadable).toBeNull();
    });

    it("Still unreadable in a later iteration: stays excluded", async () => {
        await remember("unreadable-prerequisites");
        prerequisitesUnreadable(["DOT-120"]);
        const result = await selectStep.run(looping([]));

        expect(result.data.excluded).toEqual([setAside]);
    });

    it("Readable again: the task is a candidate", async () => {
        await remember(UNREAD_ONCE);
        const result = await selectStep.run(looping([]));

        expect(result.data.excluded).toEqual([]);
        expect(result.data.selected).toMatchObject({ id: "DOT-120" });
    });

    it("Read and found failing: excluded as prerequisites", async () => {
        await remember(UNREAD_ONCE);
        prerequisitesFailing(grillMeStage, ["DOT-120"]);
        const result = await selectStep.run(looping([]));

        expect(result.data.excluded).toEqual([prerequisitesExcluded("linear", "DOT-120")]);
    });

    it("Another task unreadable for the first time: not evaluable, and the remembered one stays excluded", async () => {
        await remember(UNREAD_ONCE);
        prerequisitesUnreadable(["DOT-120", "B-7"]);
        const result = await selectStep.run(looping([]));

        expect(result.outcome).toBe("not-evaluable");
        expect(result.data.excluded).toEqual([setAside]);
        expect(result.data.unreadable).toEqual({ source: "beads", id: "B-7", reason: UNREADABLE });
    });

    const outage = async (ids: readonly string[]) => {
        for (const id of ids) {
            await appendStuck(workspace.state, {
                task: `linear:${id}`,
                exclusion: UNREAD_ONCE,
                detail: UNREADABLE,
            });
        }
        prerequisitesUnreadable(ids);
        const calls: string[] = [];
        const tasks = [...ids, "OK-1"].map((id) => workTask("linear", id));
        return selectStep.run(
            selectContext({
                workspace,
                calls,
                readers: [locatedReader("linear", tasks, calls)],
                args: { loop: true },
            }),
        );
    };

    it("Three at once: all three are excluded and another task is selected", async () => {
        const result = await outage(["DOT-1", "DOT-2", "DOT-3"]);

        expect(result.outcome).toBe("advance");
        expect(result.data.excluded.map(({ id, reason }) => [id, reason])).toEqual([
            ["DOT-1", "unreadable-prerequisites"],
            ["DOT-2", "unreadable-prerequisites"],
            ["DOT-3", "unreadable-prerequisites"],
        ]);
        expect(result.data.selected).toMatchObject({ id: "OK-1" });
    });

    it("A fourth at once: not evaluable, naming the fourth, and nothing is selected", async () => {
        const result = await outage(["DOT-1", "DOT-2", "DOT-3", "DOT-4"]);

        expect(result.outcome).toBe("not-evaluable");
        expect(result.reasons).toEqual([UNREADABLE]);
        expect(result.data.unreadable).toEqual({
            source: "linear",
            id: "DOT-4",
            reason: UNREADABLE,
        });
        expect(result.data.selected).toBeNull();
    });

    it("Manual run: not evaluable, as nothing is remembered outside the loop", async () => {
        await remember(UNREAD_ONCE);
        prerequisitesUnreadable(["DOT-120"]);
        const calls: string[] = [];
        const result = await selectStep.run(
            selectContext({
                workspace,
                calls,
                readers: twoCandidates(calls),
                selection: pickDot120(),
            }),
        );

        expect(result.outcome).toBe("not-evaluable");
        expect(result.data.excluded).toEqual([]);
    });
});

describe("select: stuck tasks", () => {
    it("Running attempt: a task excluded as open attempt with a started attempt is not stuck", async () => {
        await writeRecord(
            workspace.state,
            record({
                id: "linear:DOT-120:grill-me:1",
                task: { source: "linear", id: "DOT-120", title: "Task DOT-120" },
                stage: "grill-me",
            }),
        );
        const calls: string[] = [];
        const result = await selectStep.run(
            selectContext({ workspace, calls, readers: twoCandidates(calls) }),
        );

        expect(result.data.excluded).toMatchObject([
            { id: "DOT-120", reason: "open-attempt", stuck: false },
        ]);
    });

    it("No free slot: a task excluded as no free slot is not stuck", async () => {
        const kind = { occupied: 1, limit: 1, source: "default", attempts: [], full: true };
        const calls: string[] = [];
        const result = await selectStep.run(
            selectContext({
                workspace,
                calls,
                readers: [locatedReader("linear", [workTask("linear", "DOT-1")], calls)],
                results: [
                    {
                        step: "capacity",
                        tier: "code",
                        outcome: "advance",
                        reasons: [],
                        data: { grill: kind, work: kind },
                    },
                ],
                args: { loop: true },
            }),
        );

        expect(result.data.excluded).toMatchObject([
            { id: "DOT-1", reason: "no-free-slot", detail: null, stuck: false },
        ]);
    });

    it("Stuck task in JSON: an entry excluded as prerequisites carries the exclusion, the reason, that it is stuck and its scope", async () => {
        prerequisitesFailing(grillMeStage, ["DOT-120"]);
        const calls: string[] = [];
        const result = await selectStep.run(
            selectContext({
                workspace,
                calls,
                readers: twoCandidates(calls),
                selection: pickDot120(),
                args: { json: true },
            }),
        );
        const data = JSON.parse(JSON.stringify(result.data)) as SelectData;

        expect(data.excluded).toEqual([
            {
                source: "linear",
                id: "DOT-120",
                title: "Task DOT-120",
                reason: "prerequisites",
                detail: "DOT-120 lacks a skill",
                stuck: true,
                scope: "personal",
            },
        ]);
    });
});
