import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { applyAnswers } from "../answer-mode.ts";
import type { Answer } from "../args.ts";
import { attemptId, type AttemptRecord } from "../attempts/record.ts";
import {
    attemptDir,
    receiptPath,
    recordPath,
    transitionedPath,
    writeJsonAtomic,
    writeRecord,
} from "../attempts/state.ts";
import { record as startedAttempt, tempState } from "../attempts/test-fixtures.ts";
import type { AutonomousConfig, Source } from "../config.ts";
import { MEANINGS } from "../label-contract/contract.ts";
import { config, task, trackers } from "../label-triage/test-fixtures.ts";
import type { TrackerLabel, Trackers } from "../label-triage/trackers/tracker.ts";
import { READ_BACK_DELAYS_MS } from "../read-back.ts";
import { exitCodeFor } from "../report.ts";
import type { AnswerContext, AnswerRecord } from "../runner.ts";
import { run as checkRun } from "../review-bots/test-fixtures.ts";
import { transitionHandler } from "./answer.ts";
import { applyTransition } from "./apply.ts";
import type { GuardTools } from "./guards.ts";
import {
    renderTransitionJson,
    renderTransitionText,
    runTransition,
    TRANSITION,
    type TransitionDeps,
    transitionQuestionId,
    unconfiguredTransition,
} from "./mode.ts";
import {
    BRANCH,
    CHANGE,
    FINDINGS,
    NO_TOOLS,
    PULL_REQUEST,
    type Reviewed,
    stateInReview,
    stateWithWorkspace,
    type Work,
    workTools,
} from "./test-fixtures.ts";
import { transitionRow } from "./table.ts";
import { readTransitioned, TRANSITIONED_SCHEMA } from "./transitioned.ts";
import { digestOf } from "../publish/receipt.ts";

const STARTED = new Date("2026-11-01T09:00:00.000Z");

const CONTRACT = [
    "work",
    "personal",
    "AFK",
    "HITL",
    "grill-me",
    "proposal",
    "implement",
    "verify",
    "code-review",
    "external-review",
    "wrap-up",
    "taken",
];

// Linear has every contract label at workspace level, as after --bootstrap-labels.
const LINEAR_LABELS: TrackerLabel[] = CONTRACT.map((name) => ({
    scope: "workspace",
    name,
    colour: null,
}));

type FakeOptions = NonNullable<NonNullable<Parameters<typeof trackers>[2]>["linear"]>;

function linear(calls: string[], labels: string[], options: FakeOptions = {}): Trackers {
    const listing = [task("linear", "DOT-110", labels, { title: "Grill-me stage" })];
    return trackers(
        calls,
        { linear: listing },
        { linear: { createsLabels: true, labels: LINEAR_LABELS, ...options } },
    );
}

function disabled(source: Source): AutonomousConfig {
    const given = config();
    return {
        ...given,
        sources: { ...given.sources, [source]: { ...given.sources[source], enabled: false } },
    };
}

function context(given: Trackers, configured: AutonomousConfig = config()): AnswerContext {
    return { config: configured, trackers: given };
}

// A state directory that does not exist: no attempt, so nothing waits for a receipt.
const NO_STATE = join(tmpdir(), "autonomous-transition-no-state");

function modeDeps(
    given: Trackers,
    configured: AutonomousConfig = config(),
    state: string = NO_STATE,
    tools: GuardTools = NO_TOOLS,
): TransitionDeps {
    return { config: configured, trackers: given, state, ...tools };
}

function answer(id: string, ...values: string[]): Answer {
    return { id, values };
}

function waiting(waits: number[]): (ms: number) => Promise<void> {
    return (ms) => {
        waits.push(ms);
        return Promise.resolve();
    };
}

async function transitionWaiting(
    given: Trackers,
    waits: number[],
    id: string,
    ...values: string[]
): Promise<AnswerRecord> {
    const [record] = await transitionHandler(NO_STATE, NO_TOOLS, waiting(waits)).answer(
        [answer(id, ...values)],
        context(given),
    );
    if (record === undefined) {
        throw new Error(`no record for ${id}`);
    }
    return record;
}

function transition(given: Trackers, id: string, ...values: string[]): Promise<AnswerRecord> {
    return transitionWaiting(given, [], id, ...values);
}

async function labelsOf(given: Trackers, source: Source, id: string): Promise<string[]> {
    const read = await given[source].readTask(id);
    return read.ok ? read.value.labels : [];
}

function failingRemoval(given: Trackers, source: Source, label: string, error: string): Trackers {
    const tracker = given[source];
    return {
        ...given,
        [source]: {
            ...tracker,
            removeLabel: (id: string, name: string) =>
                name === label
                    ? Promise.resolve({ ok: false, error })
                    : tracker.removeLabel(id, name),
        },
    };
}

// After each label write, the next `reads` reads still return the labels from before it, as
// Linear's reads lagged a write (DOT-121).
function lagging(given: Trackers, source: Source, reads: number): Trackers {
    const tracker = given[source];
    let stale: string[] = [];
    let left = 0;
    const before = async (id: string) => {
        stale = await labelsOf(given, source, id);
        left = reads;
    };
    return {
        ...given,
        [source]: {
            ...tracker,
            readTask: async (id: string) => {
                const read = await tracker.readTask(id);
                if (!read.ok || left === 0) {
                    return read;
                }
                left -= 1;
                return { ok: true, value: { ...read.value, labels: stale } };
            },
            addLabel: async (id: string, label: string) => {
                await before(id);
                return tracker.addLabel(id, label);
            },
            removeLabel: async (id: string, label: string) => {
                await before(id);
                return tracker.removeLabel(id, label);
            },
        },
    };
}

// The tracker accepts every removal and keeps the label.
function keepingOnRemoval(given: Trackers, source: Source): Trackers {
    return {
        ...given,
        [source]: {
            ...given[source],
            removeLabel: () => Promise.resolve({ ok: true, value: undefined }),
        },
    };
}

function unreadableAfterWrite(given: Trackers, source: Source, error: string): Trackers {
    const tracker = given[source];
    let wrote = false;
    return {
        ...given,
        [source]: {
            ...tracker,
            readTask: async (id: string) => {
                const read = await tracker.readTask(id);
                return wrote ? { ok: false, error } : read;
            },
            addLabel: (id: string, label: string) => {
                wrote = true;
                return tracker.addLabel(id, label);
            },
        },
    };
}

const writes = (calls: readonly string[]) =>
    calls.filter((call) => call.includes(":addLabel:") || call.includes(":removeLabel:"));

const removals = (calls: readonly string[]) =>
    calls.filter((call) => call.includes(":removeLabel:"));

const kept: string[] = [];

afterEach(() => {
    for (const directory of kept.splice(0)) {
        rmSync(directory, { recursive: true, force: true });
    }
});

function workspaceDir(): string {
    const directory = mkdtempSync(join(tmpdir(), "autonomous-workspace-"));
    kept.push(directory);
    return directory;
}

// The guards' view of a task in implement: an attempt whose workspace exists, and git and
// openspec answering as `work` says (finished work by default).
async function guarded(
    source: Source,
    id: string,
    work: Work = {},
): Promise<{ state: string; tools: GuardTools }> {
    const { state, workspace } = await stateWithWorkspace({ source, id });
    kept.push(state, workspace);
    return { state, tools: workTools(work) };
}

async function questionFor(source: Source, id: string, labels: string[]) {
    const given = trackers([], { [source]: [task(source, id, labels)] });
    const { state, tools } = await guarded(source, id);
    const report = await runTransition(
        { source, id },
        modeDeps(given, config(), state, tools),
        STARTED,
    );
    const question = report.handoff?.questions[0];
    if (question === undefined) {
        throw new Error(`no question for ${source} ${id}`);
    }
    return question;
}

describe("transition mode: Transition mode", () => {
    it("Task in grill-me: one question, outcome advance, and nothing is written", async () => {
        const calls: string[] = [];
        const given = linear(calls, ["personal", "grill-me"]);

        const report = await runTransition(
            { source: "linear", id: "DOT-110" },
            modeDeps(given),
            STARTED,
        );

        expect(report).toEqual({
            schema: "autonomous.transition.v1",
            startedAt: "2026-11-01T09:00:00.000Z",
            outcome: "advance",
            applied: false,
            task: {
                source: "linear",
                id: "DOT-110",
                title: "Grill-me stage",
                labels: ["personal", "grill-me"],
            },
            reasons: [],
            handoff: {
                questions: [
                    {
                        id: "transition:linear:DOT-110",
                        step: "transition",
                        header: "DOT-110",
                        question: [
                            'linear DOT-110 "Grill-me stage": the grill is over. Which autonomy does the task keep?',
                            "Labels: [personal, grill-me]",
                        ].join("\n"),
                        options: [
                            { label: "AFK", value: "AFK", description: MEANINGS.AFK },
                            { label: "HITL", value: "HITL", description: MEANINGS.HITL },
                            {
                                label: "Later",
                                value: null,
                                description: "Leave the task in grill-me",
                            },
                        ],
                        multiSelect: false,
                    },
                ],
                remaining: 0,
            },
        });
        expect(calls).toEqual(["linear:readTask:DOT-110"]);
    });

    it("Task not in grill-me: in none of grill-me, proposal, implement, verify, code-review and external-review, no handoff and exit 3", async () => {
        const calls: string[] = [];
        const given = linear(calls, ["personal", "AFK", "wrap-up"]);

        const report = await runTransition(
            { source: "linear", id: "DOT-110" },
            modeDeps(given),
            STARTED,
        );

        expect(report.outcome).toBe("not-evaluable");
        expect(report.applied).toBe(false);
        expect(report.task).toEqual({
            source: "linear",
            id: "DOT-110",
            title: "Grill-me stage",
            labels: ["personal", "AFK", "wrap-up"],
        });
        expect(report.reasons).toEqual([
            "linear DOT-110 is in none of grill-me, proposal, implement, verify, code-review and external-review (labels [personal, AFK, wrap-up])",
        ]);
        expect(report).not.toHaveProperty("handoff");
        expect(exitCodeFor(report.outcome)).toBe(3);
        expect(calls).toEqual(["linear:readTask:DOT-110"]);
    });

    it("HITL task in proposal: the approval question, nothing written and exit 0", async () => {
        const calls: string[] = [];
        const given = linear(calls, ["personal", "HITL", "proposal"]);

        const report = await runTransition(
            { source: "linear", id: "DOT-110" },
            modeDeps(given),
            STARTED,
        );

        expect(report).toMatchObject({ outcome: "advance", applied: false, reasons: [] });
        expect(report.handoff?.questions.map(({ id, options }) => ({ id, options }))).toEqual([
            {
                id: "transition:linear:DOT-110",
                options: [
                    {
                        label: "Approve",
                        value: "implement",
                        description: "Move the task to implement",
                    },
                    { label: "Later", value: null, description: "Leave the task in proposal" },
                ],
            },
        ]);
        expect(exitCodeFor(report.outcome)).toBe(0);
        expect(calls).toEqual(["linear:readTask:DOT-110"]);
        expect(await labelsOf(given, "linear", "DOT-110")).toEqual([
            "personal",
            "HITL",
            "proposal",
        ]);
    });

    it("AFK task in proposal: implement replaces proposal, applied, no handoff and exit 0", async () => {
        const calls: string[] = [];
        const given = linear(calls, ["personal", "AFK", "proposal"]);

        const report = await runTransition(
            { source: "linear", id: "DOT-110" },
            modeDeps(given),
            STARTED,
        );

        expect(report).toMatchObject({ outcome: "advance", applied: true, reasons: [] });
        expect(report.task?.labels).toEqual(["personal", "AFK", "implement"]);
        expect(report).not.toHaveProperty("handoff");
        expect(exitCodeFor(report.outcome)).toBe(0);
        expect(writes(calls)).toEqual([
            "linear:addLabel:DOT-110:implement",
            "linear:removeLabel:DOT-110:proposal",
        ]);
        expect(await labelsOf(given, "linear", "DOT-110")).toEqual([
            "personal",
            "AFK",
            "implement",
        ]);
    });

    it("implement not bootstrapped: nothing is written, the reason names --bootstrap-labels and exit 3", async () => {
        const calls: string[] = [];
        const given = linear(calls, ["personal", "AFK", "proposal"], {
            labels: LINEAR_LABELS.filter((label) => label.name !== "implement"),
        });

        const report = await runTransition(
            { source: "linear", id: "DOT-110" },
            modeDeps(given),
            STARTED,
        );

        expect(report).toMatchObject({
            outcome: "not-evaluable",
            applied: false,
            reasons: ["implement is missing on linear; run --bootstrap-labels"],
        });
        expect(report).not.toHaveProperty("handoff");
        expect(exitCodeFor(report.outcome)).toBe(3);
        expect(writes(calls)).toEqual([]);
    });

    it("AFK task in implement: verify replaces implement, applied, no handoff and exit 0", async () => {
        const calls: string[] = [];
        const given = linear(calls, ["personal", "AFK", "implement"]);

        const { state, tools } = await guarded("linear", "DOT-110");
        const report = await runTransition(
            { source: "linear", id: "DOT-110" },
            modeDeps(given, config(), state, tools),
            STARTED,
        );

        expect(report).toMatchObject({ outcome: "advance", applied: true, reasons: [] });
        expect(report.task?.labels).toEqual(["personal", "AFK", "verify"]);
        expect(report).not.toHaveProperty("handoff");
        expect(exitCodeFor(report.outcome)).toBe(0);
        expect(writes(calls)).toEqual([
            "linear:addLabel:DOT-110:verify",
            "linear:removeLabel:DOT-110:implement",
        ]);
        expect(await labelsOf(given, "linear", "DOT-110")).toEqual(["personal", "AFK", "verify"]);
    });

    it("HITL task in implement: the approval question, nothing written and exit 0", async () => {
        const calls: string[] = [];
        const given = linear(calls, ["personal", "HITL", "implement"]);

        const { state, tools } = await guarded("linear", "DOT-110");
        const report = await runTransition(
            { source: "linear", id: "DOT-110" },
            modeDeps(given, config(), state, tools),
            STARTED,
        );

        expect(report).toMatchObject({ outcome: "advance", applied: false, reasons: [] });
        expect(report.handoff?.questions.map(({ id, options }) => ({ id, options }))).toEqual([
            {
                id: "transition:linear:DOT-110",
                options: [
                    { label: "Approve", value: "verify", description: "Move the task to verify" },
                    { label: "Later", value: null, description: "Leave the task in implement" },
                ],
            },
        ]);
        expect(exitCodeFor(report.outcome)).toBe(0);
        expect(calls).toEqual(["linear:readTask:DOT-110"]);
    });

    it("verify not bootstrapped: nothing is written, the reason names --bootstrap-labels and exit 3", async () => {
        const calls: string[] = [];
        const given = linear(calls, ["personal", "AFK", "implement"], {
            labels: LINEAR_LABELS.filter((label) => label.name !== "verify"),
        });

        const { state, tools } = await guarded("linear", "DOT-110");
        const report = await runTransition(
            { source: "linear", id: "DOT-110" },
            modeDeps(given, config(), state, tools),
            STARTED,
        );

        expect(report).toMatchObject({
            outcome: "not-evaluable",
            applied: false,
            reasons: ["verify is missing on linear; run --bootstrap-labels"],
        });
        expect(report).not.toHaveProperty("handoff");
        expect(exitCodeFor(report.outcome)).toBe(3);
        expect(writes(calls)).toEqual([]);
    });

    it("AFK task in verify: code-review replaces verify, applied, no handoff and exit 0", async () => {
        const calls: string[] = [];
        const given = linear(calls, ["personal", "AFK", "verify"]);

        const { state, tools } = await guarded("linear", "DOT-110");
        const report = await runTransition(
            { source: "linear", id: "DOT-110" },
            modeDeps(given, config(), state, tools),
            STARTED,
        );

        expect(report).toMatchObject({ outcome: "advance", applied: true, reasons: [] });
        expect(report.task?.labels).toEqual(["personal", "AFK", "code-review"]);
        expect(report).not.toHaveProperty("handoff");
        expect(exitCodeFor(report.outcome)).toBe(0);
        expect(writes(calls)).toEqual([
            "linear:addLabel:DOT-110:code-review",
            "linear:removeLabel:DOT-110:verify",
        ]);
        expect(await labelsOf(given, "linear", "DOT-110")).toEqual([
            "personal",
            "AFK",
            "code-review",
        ]);
    });

    it("Second run after a lost read-back: with --from implement, a task already in verify is refused and nothing is written", async () => {
        const calls: string[] = [];
        const given = linear(calls, ["personal", "AFK", "verify"]);

        const { state, tools } = await guarded("linear", "DOT-110");
        const report = await runTransition(
            { source: "linear", id: "DOT-110" },
            modeDeps(given, config(), state, tools),
            STARTED,
            "implement",
        );

        expect(report).toMatchObject({ outcome: "not-evaluable", applied: false });
        expect(report.reasons).toEqual([
            "linear DOT-110 is in verify, not implement (labels [personal, AFK, verify])",
        ]);
        expect(report).not.toHaveProperty("handoff");
        expect(exitCodeFor(report.outcome)).toBe(3);
        expect(calls).toEqual(["linear:readTask:DOT-110"]);
    });

    it("--from verify on a task already in wrap-up: in none of the stages, nothing written", async () => {
        const calls: string[] = [];
        const given = linear(calls, ["personal", "AFK", "wrap-up"]);

        const report = await runTransition(
            { source: "linear", id: "DOT-110" },
            modeDeps(given),
            STARTED,
            "verify",
        );

        expect(report.outcome).toBe("not-evaluable");
        expect(report.reasons).toEqual([
            "linear DOT-110 is in none of grill-me, proposal, implement, verify, code-review and external-review (labels [personal, AFK, wrap-up])",
        ]);
        expect(calls).toEqual(["linear:readTask:DOT-110"]);
    });

    it("--from naming the stage the task is in: the transition is applied as without it", async () => {
        const calls: string[] = [];
        const given = linear(calls, ["personal", "AFK", "verify"]);

        const { state, tools } = await guarded("linear", "DOT-110");
        const report = await runTransition(
            { source: "linear", id: "DOT-110" },
            modeDeps(given, config(), state, tools),
            STARTED,
            "verify",
        );

        expect(report).toMatchObject({ outcome: "advance", applied: true, reasons: [] });
        expect(writes(calls)).toEqual([
            "linear:addLabel:DOT-110:code-review",
            "linear:removeLabel:DOT-110:verify",
        ]);
    });

    it("--from implement on a task left with implement beside verify: completes the cut-short transition", async () => {
        const calls: string[] = [];
        const given = linear(calls, ["personal", "AFK", "implement", "verify"]);

        const { state, tools } = await guarded("linear", "DOT-110");
        const report = await runTransition(
            { source: "linear", id: "DOT-110" },
            modeDeps(given, config(), state, tools),
            STARTED,
            "implement",
        );

        expect(report).toMatchObject({ outcome: "advance", applied: true, reasons: [] });
        expect(await labelsOf(given, "linear", "DOT-110")).toEqual(["personal", "AFK", "verify"]);
    });

    it("HITL task in verify: the approval question, nothing written and exit 0", async () => {
        const calls: string[] = [];
        const given = linear(calls, ["personal", "HITL", "verify"]);

        const { state, tools } = await guarded("linear", "DOT-110");
        const report = await runTransition(
            { source: "linear", id: "DOT-110" },
            modeDeps(given, config(), state, tools),
            STARTED,
        );

        expect(report).toMatchObject({ outcome: "advance", applied: false, reasons: [] });
        expect(report.handoff?.questions.map(({ id, options }) => ({ id, options }))).toEqual([
            {
                id: "transition:linear:DOT-110",
                options: [
                    {
                        label: "Approve",
                        value: "code-review",
                        description: "Move the task to code-review",
                    },
                    { label: "Later", value: null, description: "Leave the task in verify" },
                ],
            },
        ]);
        expect(exitCodeFor(report.outcome)).toBe(0);
        expect(calls).toEqual(["linear:readTask:DOT-110"]);
    });

    it("code-review not bootstrapped: nothing is written, the reason names --bootstrap-labels and exit 3", async () => {
        const calls: string[] = [];
        const given = linear(calls, ["personal", "AFK", "verify"], {
            labels: LINEAR_LABELS.filter((label) => label.name !== "code-review"),
        });

        const { state, tools } = await guarded("linear", "DOT-110");
        const report = await runTransition(
            { source: "linear", id: "DOT-110" },
            modeDeps(given, config(), state, tools),
            STARTED,
        );

        expect(report).toMatchObject({
            outcome: "not-evaluable",
            applied: false,
            reasons: ["code-review is missing on linear; run --bootstrap-labels"],
        });
        expect(report).not.toHaveProperty("handoff");
        expect(exitCodeFor(report.outcome)).toBe(3);
        expect(writes(calls)).toEqual([]);
    });

    it("an AFK transition whose write fails is not applied and exits 3", async () => {
        const calls: string[] = [];
        const error = "linear issue update DOT-110 --label implement: rate limited";
        const given = linear(calls, ["personal", "AFK", "proposal"], {
            addLabelErrors: { implement: error },
        });

        const report = await runTransition(
            { source: "linear", id: "DOT-110" },
            modeDeps(given),
            STARTED,
        );

        expect(report).toMatchObject({ outcome: "not-evaluable", applied: false });
        expect(report.reasons).toEqual([
            `${error} (before [personal, AFK, proposal] → after [personal, AFK, proposal]); nothing was removed`,
        ]);
        expect(exitCodeFor(report.outcome)).toBe(3);
        expect(removals(calls)).toEqual([]);
    });

    it.each<[string, string[], string]>([
        ["missing", ["personal", "proposal"], "has no autonomy"],
        [
            "in conflict",
            ["personal", "AFK", "HITL", "proposal"],
            "has conflicting autonomy [AFK, HITL]",
        ],
    ])(
        "a task in proposal whose autonomy is %s: the reason, no handoff, nothing written and exit 3",
        async (_name, labels, problem) => {
            const calls: string[] = [];
            const given = linear(calls, labels);

            const report = await runTransition(
                { source: "linear", id: "DOT-110" },
                modeDeps(given),
                STARTED,
            );

            expect(report).toMatchObject({
                outcome: "not-evaluable",
                applied: false,
                reasons: [`linear DOT-110 in proposal ${problem}: expected one of AFK, HITL`],
            });
            expect(report).not.toHaveProperty("handoff");
            expect(exitCodeFor(report.outcome)).toBe(3);
            expect(calls).toEqual(["linear:readTask:DOT-110"]);
        },
    );

    it.each<[string, string[], string]>([
        ["missing", ["personal", "implement"], "has no autonomy"],
        [
            "in conflict",
            ["personal", "AFK", "HITL", "implement"],
            "has conflicting autonomy [AFK, HITL]",
        ],
    ])(
        "a task in implement whose autonomy is %s: the reason, no handoff, nothing written and exit 3",
        async (_name, labels, problem) => {
            const calls: string[] = [];
            const given = linear(calls, labels);

            const report = await runTransition(
                { source: "linear", id: "DOT-110" },
                modeDeps(given),
                STARTED,
            );

            expect(report).toMatchObject({
                outcome: "not-evaluable",
                applied: false,
                reasons: [`linear DOT-110 in implement ${problem}: expected one of AFK, HITL`],
            });
            expect(report).not.toHaveProperty("handoff");
            expect(exitCodeFor(report.outcome)).toBe(3);
            expect(calls).toEqual(["linear:readTask:DOT-110"]);
        },
    );

    it("a disabled source is not read and gives no task", async () => {
        const calls: string[] = [];
        const given = linear(calls, ["personal", "grill-me"]);

        const report = await runTransition(
            { source: "linear", id: "DOT-110" },
            modeDeps(given, disabled("linear")),
            STARTED,
        );

        expect(report).toMatchObject({
            outcome: "not-evaluable",
            task: null,
            reasons: ["linear is not enabled"],
        });
        expect(report).not.toHaveProperty("handoff");
        expect(calls).toEqual([]);
    });

    it("an unreadable task gives no task and the tracker's error as the reason", async () => {
        const error = "linear issue view DOT-110: Linear CLI is not authenticated";
        const given = linear([], ["personal", "grill-me"], {
            readErrors: { "DOT-110": error },
        });

        const report = await runTransition(
            { source: "linear", id: "DOT-110" },
            modeDeps(given),
            STARTED,
        );

        expect(report).toMatchObject({ outcome: "not-evaluable", task: null, reasons: [error] });
        expect(report).not.toHaveProperty("handoff");
    });
});

describe("transition mode: Transition question", () => {
    it("Autonomy decided before the grill: only HITL's description begins with current ·", async () => {
        const question = await questionFor("linear", "DOT-110", ["HITL", "grill-me"]);

        expect(question.options.map((option) => option.label)).toEqual(["AFK", "HITL", "Later"]);
        const current = question.options.filter((option) =>
            option.description.startsWith("current · "),
        );
        expect(current.map((option) => option.label)).toEqual(["HITL"]);
        expect(current[0]?.description).toBe(`current · ${MEANINGS.HITL}`);
    });

    it("No autonomy yet: no option is marked current", async () => {
        const question = await questionFor("linear", "DOT-110", ["work", "grill-me"]);

        expect(question.options.some((option) => option.description.includes("current"))).toBe(
            false,
        );
    });

    it("the header is the task id up to 12 characters and autonomy beyond", async () => {
        const short = await questionFor("beads", "agentic-8v0x", ["work", "grill-me"]);
        const long = await questionFor("github", "owner/repo#123", ["work", "grill-me"]);

        expect(short.header).toBe("agentic-8v0x");
        expect(long.header).toBe("autonomy");
        expect(long.id).toBe("transition:github:owner/repo#123");
    });

    it("Later is the only null value, no scope is offered and the description is not quoted", async () => {
        const question = await questionFor("github", "owner/repo#123", ["work", "grill-me"]);

        expect(question.options.filter((option) => option.value === null)).toEqual([
            { label: "Later", value: null, description: "Leave the task in grill-me" },
        ]);
        expect(question.options.map((option) => option.value)).toEqual(["AFK", "HITL", null]);
        expect(question.multiSelect).toBe(false);
        expect(question.step).toBe(TRANSITION);
        expect(question.question).not.toContain("About owner/repo#123");
    });

    it("the question id names the transition, the source and the task", () => {
        expect(transitionQuestionId({ source: "linear", id: "DOT-110" })).toBe(
            "transition:linear:DOT-110",
        );
    });
});

describe("transition mode: Approval question", () => {
    it("Options: Approve and Later only, a single choice asking for no autonomy or scope", async () => {
        const question = await questionFor("linear", "DOT-110", ["personal", "HITL", "proposal"]);

        expect(question).toEqual({
            id: "transition:linear:DOT-110",
            step: TRANSITION,
            header: "DOT-110",
            question: [
                'linear DOT-110 "Task DOT-110": the proposal is ready. Approve it to move the task to implement?',
                "Labels: [personal, HITL, proposal]",
            ].join("\n"),
            options: [
                { label: "Approve", value: "implement", description: "Move the task to implement" },
                { label: "Later", value: null, description: "Leave the task in proposal" },
            ],
            multiSelect: false,
        });
    });

    it("Implementation ready: the question says so and Approve carries verify", async () => {
        const question = await questionFor("linear", "DOT-110", ["personal", "HITL", "implement"]);

        expect(question).toEqual({
            id: "transition:linear:DOT-110",
            step: TRANSITION,
            header: "DOT-110",
            question: [
                'linear DOT-110 "Task DOT-110": the implementation is ready. Approve it to move the task to verify?',
                "Labels: [personal, HITL, implement]",
            ].join("\n"),
            options: [
                { label: "Approve", value: "verify", description: "Move the task to verify" },
                { label: "Later", value: null, description: "Leave the task in implement" },
            ],
            multiSelect: false,
        });
    });

    it("Verification ready: the question says so and Approve carries code-review", async () => {
        const question = await questionFor("linear", "DOT-110", ["personal", "HITL", "verify"]);

        expect(question).toEqual({
            id: "transition:linear:DOT-110",
            step: TRANSITION,
            header: "DOT-110",
            question: [
                'linear DOT-110 "Task DOT-110": the verification is ready. Approve it to move the task to code-review?',
                "Labels: [personal, HITL, verify]",
            ].join("\n"),
            options: [
                {
                    label: "Approve",
                    value: "code-review",
                    description: "Move the task to code-review",
                },
                { label: "Later", value: null, description: "Leave the task in verify" },
            ],
            multiSelect: false,
        });
    });

    it("the header is the task id up to 12 characters and approval beyond", async () => {
        const long = await questionFor("github", "owner/repo#123", ["work", "HITL", "proposal"]);

        expect(long.header).toBe("approval");
        expect(long.id).toBe("transition:github:owner/repo#123");
    });

    it("Later: an answer of Later is rejected, nothing is written and the task keeps proposal", async () => {
        const calls: string[] = [];
        const given = linear(calls, ["personal", "HITL", "proposal"]);

        const record = await transition(given, "transition:linear:DOT-110", "Later");

        expect(record.status).toBe("rejected");
        expect(writes(calls)).toEqual([]);
        expect(await labelsOf(given, "linear", "DOT-110")).toEqual([
            "personal",
            "HITL",
            "proposal",
        ]);
    });
});

describe("transition mode: Transition report", () => {
    it("Transition JSON report: schema autonomous.transition.v1, the task and a handoff with one question", async () => {
        const given = linear([], ["personal", "grill-me"]);
        const report = await runTransition(
            { source: "linear", id: "DOT-110" },
            modeDeps(given),
            STARTED,
        );

        const parsed: unknown = JSON.parse(renderTransitionJson(report));

        expect(parsed).toEqual(report);
        expect(parsed).toMatchObject({
            schema: "autonomous.transition.v1",
            task: { source: "linear", id: "DOT-110" },
            handoff: { questions: [{ id: "transition:linear:DOT-110" }], remaining: 0 },
        });
    });

    it("Transition text report: the last line is handoff: and the handoff as one line of JSON", async () => {
        const given = linear([], ["personal", "grill-me"]);
        const report = await runTransition(
            { source: "linear", id: "DOT-110" },
            modeDeps(given),
            STARTED,
        );

        const lines = renderTransitionText(report).split("\n");
        const last = lines.at(-1) ?? "";

        expect(lines.slice(0, -1)).toEqual([
            "autonomous transition — started 2026-11-01T09:00:00.000Z",
            "outcome: advance",
            'task: linear DOT-110 → "Grill-me stage" → labels [personal, grill-me]',
        ]);
        expect(last.startsWith("handoff: ")).toBe(true);
        expect(JSON.parse(last.slice("handoff: ".length))).toEqual(report.handoff);
    });

    it("the text of a task in neither stage lists the reason and no handoff", async () => {
        const given = linear([], ["personal", "AFK", "wrap-up"]);
        const report = await runTransition(
            { source: "linear", id: "DOT-110" },
            modeDeps(given),
            STARTED,
        );

        expect(renderTransitionText(report)).toBe(
            [
                "autonomous transition — started 2026-11-01T09:00:00.000Z",
                "outcome: not-evaluable",
                'task: linear DOT-110 → "Grill-me stage" → labels [personal, AFK, wrap-up]',
                "reasons:",
                "  - linear DOT-110 is in none of grill-me, proposal, implement, verify, code-review and external-review (labels [personal, AFK, wrap-up])",
            ].join("\n"),
        );
    });

    it("the text of an applied transition says so and ends with no handoff", async () => {
        const given = linear([], ["personal", "AFK", "proposal"]);
        const report = await runTransition(
            { source: "linear", id: "DOT-110" },
            modeDeps(given),
            STARTED,
        );

        expect(renderTransitionText(report)).toBe(
            [
                "autonomous transition — started 2026-11-01T09:00:00.000Z",
                "outcome: advance",
                "applied: true",
                'task: linear DOT-110 → "Grill-me stage" → labels [personal, AFK, implement]',
            ].join("\n"),
        );
        expect(JSON.parse(renderTransitionJson(report))).toMatchObject({ applied: true });
    });

    it("the text of an unreadable task says so", async () => {
        const given = linear([], [], { readErrors: { "DOT-110": "boom" } });
        const report = await runTransition(
            { source: "linear", id: "DOT-110" },
            modeDeps(given),
            STARTED,
        );

        expect(renderTransitionText(report).split("\n").slice(2)).toEqual([
            "task: unreadable",
            "reasons:",
            "  - boom",
        ]);
    });

    it("unconfiguredTransition carries the configuration error and no task", () => {
        const report = unconfiguredTransition("/c.json", "bad config", STARTED);

        expect(report).toEqual({
            schema: "autonomous.transition.v1",
            startedAt: "2026-11-01T09:00:00.000Z",
            outcome: "not-evaluable",
            applied: false,
            task: null,
            reasons: [],
            config: { path: "/c.json", error: "bad config" },
        });
        expect(JSON.parse(renderTransitionJson(report))).toEqual(report);
        expect(renderTransitionText(report)).toBe(
            "autonomous transition — started 2026-11-01T09:00:00.000Z\noutcome: not-evaluable",
        );
    });
});

describe("transition answers: Transition answers", () => {
    it("Transition applied: work, HITL, grill-me + AFK → work, AFK, proposal, with every add before any removal", async () => {
        const calls: string[] = [];
        const given = linear(calls, ["work", "HITL", "grill-me"]);

        const record = await transition(given, "transition:linear:DOT-110", "AFK");

        expect(record).toEqual({
            id: "transition:linear:DOT-110",
            labels: ["AFK"],
            status: "applied",
            detail: "added AFK, proposal, removed HITL, grill-me on linear DOT-110, read back",
        });
        expect(calls).toEqual([
            "linear:readTask:DOT-110",
            "linear:listLabels",
            "linear:addLabel:DOT-110:AFK",
            "linear:addLabel:DOT-110:proposal",
            "linear:readTask:DOT-110",
            "linear:removeLabel:DOT-110:HITL",
            "linear:removeLabel:DOT-110:grill-me",
            "linear:readTask:DOT-110",
        ]);
        expect(await labelsOf(given, "linear", "DOT-110")).toEqual(["work", "AFK", "proposal"]);
    });

    it("Already moved on: skipped, naming the stage, and nothing is written", async () => {
        const calls: string[] = [];
        const given = linear(calls, ["personal", "AFK", "proposal"]);

        const record = await transition(given, "transition:linear:DOT-110", "AFK");

        expect(record).toMatchObject({
            status: "skipped",
            detail: "already moved on: stage [proposal]",
        });
        expect(calls).toEqual(["linear:readTask:DOT-110"]);
    });

    it("proposal not bootstrapped: failed naming --bootstrap-labels, and the labels are unchanged", async () => {
        const calls: string[] = [];
        const repository = (scope: string, name: string): TrackerLabel => ({
            scope,
            name,
            colour: null,
        });
        const given = trackers(
            calls,
            { github: [task("github", "owner/repo#7", ["work", "grill-me"])] },
            {
                github: {
                    createsLabels: true,
                    labels: [
                        repository("owner/repo", "HITL"),
                        repository("owner/repo", "grill-me"),
                        repository("owner/other", "proposal"),
                    ],
                },
            },
        );

        const record = await transition(given, "transition:github:owner/repo#7", "HITL");

        expect(record).toEqual({
            id: "transition:github:owner/repo#7",
            labels: ["HITL"],
            status: "failed",
            detail: "proposal is missing on github; run --bootstrap-labels",
        });
        expect(calls).toEqual(["github:readTask:owner/repo#7", "github:listLabels"]);
        expect(await labelsOf(given, "github", "owner/repo#7")).toEqual(["work", "grill-me"]);
    });

    it("Value outside the options: grill-me is rejected and nothing is read or written", async () => {
        const calls: string[] = [];
        const given = linear(calls, ["work", "grill-me"]);

        const records = await transitionHandler(NO_STATE, NO_TOOLS).answer(
            [
                answer("transition:linear:DOT-110", "grill-me"),
                answer("transition:linear:DOT-111", "AFK", "HITL"),
                answer("transition:linear:DOT-112"),
            ],
            context(given),
        );

        const detail =
            "invalid for the transition: expected one of AFK, HITL, implement, verify, code-review, external-review, wrap-up";
        expect(records).toEqual([
            {
                id: "transition:linear:DOT-110",
                labels: ["grill-me"],
                status: "rejected",
                detail,
            },
            {
                id: "transition:linear:DOT-111",
                labels: ["AFK", "HITL"],
                status: "rejected",
                detail,
            },
            { id: "transition:linear:DOT-112", labels: [], status: "rejected", detail },
        ]);
        expect(calls).toEqual([]);
    });

    it("Proposal approved: personal, HITL, proposal + implement → personal, HITL, implement", async () => {
        const calls: string[] = [];
        const given = linear(calls, ["personal", "HITL", "proposal"]);

        const record = await transition(given, "transition:linear:DOT-110", "implement");

        expect(record).toEqual({
            id: "transition:linear:DOT-110",
            labels: ["implement"],
            status: "applied",
            detail: "added implement, removed proposal on linear DOT-110, read back",
        });
        expect(await labelsOf(given, "linear", "DOT-110")).toEqual([
            "personal",
            "HITL",
            "implement",
        ]);
    });

    it("Implementation approved: personal, HITL, implement + verify → personal, HITL, verify", async () => {
        const calls: string[] = [];
        const given = linear(calls, ["personal", "HITL", "implement"]);

        const { state, tools } = await guarded("linear", "DOT-110");

        const [record] = await transitionHandler(state, tools).answer(
            [answer("transition:linear:DOT-110", "verify")],
            context(given),
        );

        expect(record).toEqual({
            id: "transition:linear:DOT-110",
            labels: ["verify"],
            status: "applied",
            detail: "added verify, removed implement on linear DOT-110, read back",
        });
        expect(await labelsOf(given, "linear", "DOT-110")).toEqual(["personal", "HITL", "verify"]);
    });

    it("Verification approved: personal, HITL, verify + code-review → personal, HITL, code-review", async () => {
        const calls: string[] = [];
        const given = linear(calls, ["personal", "HITL", "verify"]);

        const { state, tools } = await guarded("linear", "DOT-110");

        const [record] = await transitionHandler(state, tools).answer(
            [answer("transition:linear:DOT-110", "code-review")],
            context(given),
        );

        expect(record).toEqual({
            id: "transition:linear:DOT-110",
            labels: ["code-review"],
            status: "applied",
            detail: "added code-review, removed verify on linear DOT-110, read back",
        });
        expect(await labelsOf(given, "linear", "DOT-110")).toEqual([
            "personal",
            "HITL",
            "code-review",
        ]);
    });

    it("an answer other than verify for a task in implement is skipped and nothing is written", async () => {
        const calls: string[] = [];
        const given = linear(calls, ["personal", "HITL", "implement"]);

        const record = await transition(given, "transition:linear:DOT-110", "implement");

        expect(record).toMatchObject({
            status: "skipped",
            detail: "already moved on: stage [implement]",
        });
        expect(calls).toEqual(["linear:readTask:DOT-110"]);
    });

    it("an approval for a task in implement with no autonomy is rejected and nothing is written", async () => {
        const calls: string[] = [];
        const given = linear(calls, ["personal", "implement"]);

        const record = await transition(given, "transition:linear:DOT-110", "verify");

        expect(record).toMatchObject({
            status: "rejected",
            detail: "linear DOT-110 in implement has no autonomy: expected one of AFK, HITL",
        });
        expect(calls).toEqual(["linear:readTask:DOT-110"]);
    });

    it("Autonomy answered for a task in proposal: skipped and nothing is written", async () => {
        const calls: string[] = [];
        const given = linear(calls, ["HITL", "proposal"]);

        const record = await transition(given, "transition:linear:DOT-110", "AFK");

        expect(record).toMatchObject({
            status: "skipped",
            detail: "already moved on: stage [proposal]",
        });
        expect(calls).toEqual(["linear:readTask:DOT-110"]);
    });

    it("an approval for a task still in grill-me is skipped and nothing is written", async () => {
        const calls: string[] = [];
        const given = linear(calls, ["work", "grill-me"]);

        const record = await transition(given, "transition:linear:DOT-110", "implement");

        expect(record).toMatchObject({
            status: "skipped",
            detail: "already moved on: stage [grill-me]",
        });
        expect(calls).toEqual(["linear:readTask:DOT-110"]);
    });

    it("an answer for a task in neither stage is skipped and nothing is written", async () => {
        const calls: string[] = [];
        const given = linear(calls, ["personal", "AFK", "verify"]);

        const record = await transition(given, "transition:linear:DOT-110", "verify");

        expect(record).toMatchObject({
            status: "skipped",
            detail: "already moved on: stage [verify]",
        });
        expect(calls).toEqual(["linear:readTask:DOT-110"]);
    });

    it("an approval for a task in proposal with no autonomy is rejected and nothing is written", async () => {
        const calls: string[] = [];
        const given = linear(calls, ["personal", "proposal"]);

        const record = await transition(given, "transition:linear:DOT-110", "implement");

        expect(record).toMatchObject({
            status: "rejected",
            detail: "linear DOT-110 in proposal has no autonomy: expected one of AFK, HITL",
        });
        expect(calls).toEqual(["linear:readTask:DOT-110"]);
    });

    it("a malformed id is rejected, naming the problem", async () => {
        const calls: string[] = [];
        const given = linear(calls, ["work", "grill-me"]);

        const records = await transitionHandler(NO_STATE, NO_TOOLS).answer(
            [
                answer("transition", "AFK"),
                answer("transition:linear", "AFK"),
                answer("transition:jira:X-1", "AFK"),
                answer("transition:linear:", "AFK"),
            ],
            context(given),
        );

        expect(records.map(({ status, detail }) => ({ status, detail }))).toEqual([
            {
                status: "rejected",
                detail: "malformed transition id transition: expected transition:<source>:<task>",
            },
            {
                status: "rejected",
                detail: "malformed transition id transition:linear: expected transition:<source>:<task>",
            },
            { status: "rejected", detail: "unknown source jira in transition:jira:X-1" },
            { status: "rejected", detail: "malformed transition id transition:linear:: no task" },
        ]);
        expect(calls).toEqual([]);
    });

    it("a disabled source is rejected and nothing is read", async () => {
        const calls: string[] = [];
        const given = linear(calls, ["work", "grill-me"]);

        const [record] = await transitionHandler(NO_STATE, NO_TOOLS).answer(
            [answer("transition:linear:DOT-110", "AFK")],
            context(given, disabled("linear")),
        );

        expect(record).toMatchObject({ status: "rejected", detail: "linear is not enabled" });
        expect(calls).toEqual([]);
    });

    it("an unreadable task is failed with the tracker's error", async () => {
        const calls: string[] = [];
        const error = "linear issue view DOT-110: Linear CLI is not authenticated";
        const given = linear(calls, ["work", "grill-me"], { readErrors: { "DOT-110": error } });

        const record = await transition(given, "transition:linear:DOT-110", "AFK");

        expect(record).toMatchObject({ status: "failed", detail: error });
        expect(calls).toEqual(["linear:readTask:DOT-110"]);
    });

    it("a failing label listing is failed with its error before any write", async () => {
        const calls: string[] = [];
        const error = "linear label list: Linear CLI is not authenticated";
        const given = linear(calls, ["work", "grill-me"], { labels: error });

        const record = await transition(given, "transition:linear:DOT-110", "AFK");

        expect(record).toMatchObject({ status: "failed", detail: error });
        expect(calls).toEqual(["linear:readTask:DOT-110", "linear:listLabels"]);
    });

    it("Transition answer: answer mode routes transition ids to the transition", async () => {
        const calls: string[] = [];
        const given = linear(calls, ["personal", "grill-me"]);

        const report = await applyAnswers(
            [transitionHandler(NO_STATE, NO_TOOLS)],
            [answer("transition:linear:DOT-110", "AFK"), answer("transition:linear:DOT-9", "x")],
            context(given),
            STARTED,
        );

        expect(report.answers.map(({ id, status }) => ({ id, status }))).toEqual([
            { id: "transition:linear:DOT-110", status: "applied" },
            { id: "transition:linear:DOT-9", status: "rejected" },
        ]);
        expect(await labelsOf(given, "linear", "DOT-110")).toEqual(["personal", "AFK", "proposal"]);
    });
});

describe("transition answers: A transition replaces the stage", () => {
    it("Grill ends with AFK: work, grill-me → work, AFK, proposal", async () => {
        const calls: string[] = [];
        const given = linear(calls, ["work", "grill-me"]);

        const record = await transition(given, "transition:linear:DOT-110", "AFK");

        expect(record).toMatchObject({
            status: "applied",
            detail: "added AFK, proposal, removed grill-me on linear DOT-110, read back",
        });
        expect(await labelsOf(given, "linear", "DOT-110")).toEqual(["work", "AFK", "proposal"]);
    });

    it("Autonomy replaced: HITL is removed and work, AFK, proposal remain", async () => {
        const calls: string[] = [];
        const given = trackers(calls, {
            beads: [task("beads", "X-12", ["work", "HITL", "grill-me"])],
        });

        const record = await transition(given, "transition:beads:X-12", "AFK");

        expect(record.status).toBe("applied");
        expect(removals(calls)).toEqual([
            "beads:removeLabel:X-12:HITL",
            "beads:removeLabel:X-12:grill-me",
        ]);
        expect(await labelsOf(given, "beads", "X-12")).toEqual(["work", "AFK", "proposal"]);
    });

    it("Autonomy conflict resolved: personal, AFK, HITL, grill-me + HITL → personal, HITL, proposal", async () => {
        const calls: string[] = [];
        const given = linear(calls, ["personal", "AFK", "HITL", "grill-me"]);

        const record = await transition(given, "transition:linear:DOT-110", "HITL");

        expect(record).toMatchObject({
            status: "applied",
            detail: "added proposal, removed AFK, grill-me on linear DOT-110, read back",
        });
        expect(writes(calls)).toEqual([
            "linear:addLabel:DOT-110:proposal",
            "linear:removeLabel:DOT-110:AFK",
            "linear:removeLabel:DOT-110:grill-me",
        ]);
        expect(await labelsOf(given, "linear", "DOT-110")).toEqual([
            "personal",
            "HITL",
            "proposal",
        ]);
    });

    it("Write cut short: adding proposal fails after AFK, nothing is removed and grill-me stays", async () => {
        const calls: string[] = [];
        const error = "linear issue update DOT-110 --label proposal: rate limited";
        const given = linear(calls, ["work", "grill-me"], { addLabelErrors: { proposal: error } });

        const record = await transition(given, "transition:linear:DOT-110", "AFK");

        expect(record).toEqual({
            id: "transition:linear:DOT-110",
            labels: ["AFK"],
            status: "failed",
            detail: `${error} (before [work, grill-me] → after [work, grill-me, AFK]); nothing was removed`,
        });
        expect(removals(calls)).toEqual([]);
        expect(await labelsOf(given, "linear", "DOT-110")).toEqual(["work", "grill-me", "AFK"]);
    });

    it("Proposal ready: personal, HITL, proposal → personal, HITL, implement, and only proposal was removed", async () => {
        const calls: string[] = [];
        const given = trackers(calls, {
            beads: [task("beads", "X-12", ["personal", "HITL", "proposal"])],
        });

        const record = await transition(given, "transition:beads:X-12", "implement");

        expect(record.status).toBe("applied");
        expect(writes(calls)).toEqual([
            "beads:addLabel:X-12:implement",
            "beads:removeLabel:X-12:proposal",
        ]);
        expect(await labelsOf(given, "beads", "X-12")).toEqual(["personal", "HITL", "implement"]);
    });

    it("Implementation done: personal, HITL, implement → personal, HITL, verify, and only implement was removed", async () => {
        const calls: string[] = [];
        const given = trackers(calls, {
            beads: [task("beads", "X-12", ["personal", "HITL", "implement"])],
        });

        const { state, tools } = await guarded("beads", "X-12");

        const [record] = await transitionHandler(state, tools).answer(
            [answer("transition:beads:X-12", "verify")],
            context(given),
        );

        expect(record?.status).toBe("applied");
        expect(writes(calls)).toEqual([
            "beads:addLabel:X-12:verify",
            "beads:removeLabel:X-12:implement",
        ]);
        expect(await labelsOf(given, "beads", "X-12")).toEqual(["personal", "HITL", "verify"]);
    });

    it("Verification done: personal, HITL, verify → personal, HITL, code-review, and only verify was removed", async () => {
        const calls: string[] = [];
        const given = trackers(calls, {
            beads: [task("beads", "X-12", ["personal", "HITL", "verify"])],
        });

        const { state, tools } = await guarded("beads", "X-12");

        const [record] = await transitionHandler(state, tools).answer(
            [answer("transition:beads:X-12", "code-review")],
            context(given),
        );

        expect(record?.status).toBe("applied");
        expect(writes(calls)).toEqual([
            "beads:addLabel:X-12:code-review",
            "beads:removeLabel:X-12:verify",
        ]);
        expect(await labelsOf(given, "beads", "X-12")).toEqual(["personal", "HITL", "code-review"]);
    });

    it("a removal of proposal that fails leaves it beside implement, and a second run completes it", async () => {
        const calls: string[] = [];
        const given = linear(calls, ["work", "AFK", "proposal"]);
        const error = "linear issue update DOT-110 --remove-label proposal: rate limited";

        const failed = await runTransition(
            { source: "linear", id: "DOT-110" },
            modeDeps(failingRemoval(given, "linear", "proposal", error)),
            STARTED,
        );

        expect(failed.reasons).toEqual([
            `${error} (before [work, AFK, proposal] → after [work, AFK, proposal, implement]); ` +
                "proposal may remain beside implement, answering again completes the transition",
        ]);
        expect(exitCodeFor(failed.outcome)).toBe(3);

        calls.length = 0;
        const again = await runTransition(
            { source: "linear", id: "DOT-110" },
            modeDeps(given),
            STARTED,
        );

        expect(again.applied).toBe(true);
        expect(writes(calls)).toEqual(["linear:removeLabel:DOT-110:proposal"]);
        expect(await labelsOf(given, "linear", "DOT-110")).toEqual(["work", "AFK", "implement"]);
    });

    it("Alias kept by a transition: a Beads task keeps nazaries and work", async () => {
        const calls: string[] = [];
        const given = trackers(calls, {
            beads: [task("beads", "X-12", ["nazaries", "work", "grill-me"])],
        });

        const record = await transition(given, "transition:beads:X-12", "AFK");

        expect(record.status).toBe("applied");
        expect(calls).not.toContain("beads:listLabels");
        expect(removals(calls)).toEqual(["beads:removeLabel:X-12:grill-me"]);
        expect(await labelsOf(given, "beads", "X-12")).toEqual([
            "nazaries",
            "work",
            "AFK",
            "proposal",
        ]);
    });

    it("only the stage left and the replaced autonomy are ever removed", async () => {
        const calls: string[] = [];
        const labels = ["personal", "bug", "human", "taken", "AFK", "HITL", "grill-me"];
        const given = trackers(calls, { beads: [task("beads", "X-12", labels)] });

        const record = await transition(given, "transition:beads:X-12", "HITL");

        expect(record.status).toBe("applied");
        expect(removals(calls)).toEqual([
            "beads:removeLabel:X-12:AFK",
            "beads:removeLabel:X-12:grill-me",
        ]);
        expect(await labelsOf(given, "beads", "X-12")).toEqual([
            "personal",
            "bug",
            "human",
            "taken",
            "HITL",
            "proposal",
        ]);
    });

    it("a removal that fails leaves grill-me beside proposal, and answering again completes the transition", async () => {
        const calls: string[] = [];
        const given = linear(calls, ["work", "HITL", "grill-me"]);
        const error = "linear issue update DOT-110 --remove-label HITL: rate limited";
        const broken = failingRemoval(given, "linear", "HITL", error);

        const failed = await transition(broken, "transition:linear:DOT-110", "AFK");

        expect(failed).toEqual({
            id: "transition:linear:DOT-110",
            labels: ["AFK"],
            status: "failed",
            detail:
                `${error} (before [work, HITL, grill-me] → after [work, HITL, grill-me, AFK, proposal]); ` +
                "grill-me may remain beside proposal, answering again completes the transition",
        });
        expect(await labelsOf(given, "linear", "DOT-110")).toEqual([
            "work",
            "HITL",
            "grill-me",
            "AFK",
            "proposal",
        ]);

        calls.length = 0;
        const again = await transition(given, "transition:linear:DOT-110", "AFK");

        expect(again).toMatchObject({
            status: "applied",
            detail: "removed HITL, grill-me on linear DOT-110, read back",
        });
        expect(writes(calls)).toEqual([
            "linear:removeLabel:DOT-110:HITL",
            "linear:removeLabel:DOT-110:grill-me",
        ]);
        expect(await labelsOf(given, "linear", "DOT-110")).toEqual(["work", "AFK", "proposal"]);
    });

    it("a failing removal of grill-me itself is failed with both sets, and a retry completes it", async () => {
        const calls: string[] = [];
        const given = linear(calls, ["work", "grill-me"]);
        const error = "linear issue update DOT-110 --remove-label grill-me: rate limited";

        const failed = await transition(
            failingRemoval(given, "linear", "grill-me", error),
            "transition:linear:DOT-110",
            "HITL",
        );

        expect(failed).toMatchObject({
            status: "failed",
            detail:
                `${error} (before [work, grill-me] → after [work, grill-me, HITL, proposal]); ` +
                "grill-me may remain beside proposal, answering again completes the transition",
        });

        const again = await transition(given, "transition:linear:DOT-110", "HITL");

        expect(again.status).toBe("applied");
        expect(await labelsOf(given, "linear", "DOT-110")).toEqual(["work", "HITL", "proposal"]);
    });

    it("a read-back that loses a label after the adds fails before any removal", async () => {
        const calls: string[] = [];
        const waits: number[] = [];
        const given = linear(calls, ["work", "grill-me"], { dropsOnAdd: "grill-me" });

        const record = await transitionWaiting(given, waits, "transition:linear:DOT-110", "AFK");

        expect(record).toMatchObject({
            status: "failed",
            detail: "read-back mismatch: before [work, grill-me] + [AFK, proposal] → after [work, AFK, proposal] (read 6 times over 30 s); nothing was removed",
        });
        expect(waits).toEqual([...READ_BACK_DELAYS_MS]);
        expect(removals(calls)).toEqual([]);
    });

    it("a read-back that never shows the removal fails with the hint after the tries", async () => {
        const calls: string[] = [];
        const waits: number[] = [];
        const given = linear(calls, ["work", "grill-me", "AFK", "proposal"]);

        const record = await transitionWaiting(
            keepingOnRemoval(given, "linear"),
            waits,
            "transition:linear:DOT-110",
            "AFK",
        );

        expect(record).toMatchObject({
            status: "failed",
            detail:
                "read-back mismatch: before [work, grill-me, AFK, proposal] + [] - [grill-me] → after [work, grill-me, AFK, proposal] (read 6 times over 30 s); " +
                "grill-me may remain beside proposal, answering again completes the transition",
        });
        expect(waits).toEqual([...READ_BACK_DELAYS_MS]);
    });

    it("a read-back that fails is not read again", async () => {
        const calls: string[] = [];
        const waits: number[] = [];
        const given = linear(calls, ["work", "grill-me"]);
        const error = "linear issue view DOT-110: boom";

        const record = await transitionWaiting(
            unreadableAfterWrite(given, "linear", error),
            waits,
            "transition:linear:DOT-110",
            "AFK",
        );

        expect(record).toMatchObject({
            status: "failed",
            detail: `${error} (before [work, grill-me]); nothing was removed`,
        });
        expect(waits).toEqual([]);
        expect(calls.filter((call) => call.includes(":readTask:"))).toHaveLength(2);
    });

    it("a read-back that matches at once never waits: the task is read three times in all", async () => {
        const calls: string[] = [];
        const waits: number[] = [];
        const given = linear(calls, ["work", "grill-me"]);

        const record = await transitionWaiting(given, waits, "transition:linear:DOT-110", "AFK");

        expect(record.status).toBe("applied");
        expect(waits).toEqual([]);
        expect(calls.filter((call) => call.includes(":readTask:"))).toHaveLength(3);
    });

    it("a read-back that lags the last write is read again until it shows, and the transition completes", async () => {
        const calls: string[] = [];
        const waits: number[] = [];
        const given = linear(calls, ["personal", "grill-me", "taken"]);

        const record = await transitionWaiting(
            lagging(given, "linear", 2),
            waits,
            "transition:linear:DOT-110",
            "AFK",
        );

        expect(record).toMatchObject({
            status: "applied",
            detail: "added AFK, proposal, removed grill-me on linear DOT-110, read back",
        });
        expect(waits).toEqual([1000, 2000, 1000, 2000]);
        expect(await labelsOf(given, "linear", "DOT-110")).toEqual([
            "personal",
            "taken",
            "AFK",
            "proposal",
        ]);
    });

    it("answering again after a lagging read-back only removes grill-me", async () => {
        const calls: string[] = [];
        const waits: number[] = [];
        const given = linear(calls, ["personal", "grill-me", "taken", "AFK", "proposal"]);

        const record = await transitionWaiting(
            lagging(given, "linear", 2),
            waits,
            "transition:linear:DOT-110",
            "AFK",
        );

        expect(record).toMatchObject({
            status: "applied",
            detail: "removed grill-me on linear DOT-110, read back",
        });
        expect(writes(calls)).toEqual(["linear:removeLabel:DOT-110:grill-me"]);
        expect(waits).toEqual([1000, 2000]);
        expect(await labelsOf(given, "linear", "DOT-110")).toEqual([
            "personal",
            "taken",
            "AFK",
            "proposal",
        ]);
    });
});

describe("transition: The autonomy decides whether leaving proposal needs an answer", () => {
    it("AFK task: applied with no question, work, AFK, proposal → work, AFK, implement", async () => {
        const calls: string[] = [];
        const given = linear(calls, ["work", "AFK", "proposal"]);

        const report = await runTransition(
            { source: "linear", id: "DOT-110" },
            modeDeps(given),
            STARTED,
        );

        expect(report.applied).toBe(true);
        expect(report).not.toHaveProperty("handoff");
        expect(await labelsOf(given, "linear", "DOT-110")).toEqual(["work", "AFK", "implement"]);
    });

    it("HITL task not approved: Later sends no answer, so the task keeps proposal and nothing is written", async () => {
        const calls: string[] = [];
        const given = linear(calls, ["HITL", "proposal"]);

        const report = await runTransition(
            { source: "linear", id: "DOT-110" },
            modeDeps(given),
            STARTED,
        );
        const later = report.handoff?.questions[0]?.options.find(
            (option) => option.label === "Later",
        );

        expect(later?.value).toBeNull();
        expect(writes(calls)).toEqual([]);
        expect(await labelsOf(given, "linear", "DOT-110")).toEqual(["HITL", "proposal"]);
    });

    it("Autonomy missing: personal and proposal only, nothing is written and the reason names the missing autonomy", async () => {
        const calls: string[] = [];
        const given = linear(calls, ["personal", "proposal"]);

        const report = await runTransition(
            { source: "linear", id: "DOT-110" },
            modeDeps(given),
            STARTED,
        );

        expect(report.reasons).toEqual([
            "linear DOT-110 in proposal has no autonomy: expected one of AFK, HITL",
        ]);
        expect(writes(calls)).toEqual([]);
    });
});

describe("transition: The autonomy decides whether leaving implement needs an answer", () => {
    it("AFK task: applied with no question, work, AFK, implement → work, AFK, verify", async () => {
        const calls: string[] = [];
        const given = linear(calls, ["work", "AFK", "implement"]);

        const { state, tools } = await guarded("linear", "DOT-110");
        const report = await runTransition(
            { source: "linear", id: "DOT-110" },
            modeDeps(given, config(), state, tools),
            STARTED,
        );

        expect(report.applied).toBe(true);
        expect(report).not.toHaveProperty("handoff");
        expect(await labelsOf(given, "linear", "DOT-110")).toEqual(["work", "AFK", "verify"]);
    });

    it("HITL task not approved: Later sends no answer, so the task keeps implement and nothing is written", async () => {
        const calls: string[] = [];
        const given = linear(calls, ["HITL", "implement"]);

        const { state, tools } = await guarded("linear", "DOT-110");
        const report = await runTransition(
            { source: "linear", id: "DOT-110" },
            modeDeps(given, config(), state, tools),
            STARTED,
        );
        const later = report.handoff?.questions[0]?.options.find(
            (option) => option.label === "Later",
        );

        expect(later?.value).toBeNull();
        expect(writes(calls)).toEqual([]);
        expect(await labelsOf(given, "linear", "DOT-110")).toEqual(["HITL", "implement"]);
    });

    it("Autonomy missing: personal and implement only, nothing is written and the reason names the missing autonomy", async () => {
        const calls: string[] = [];
        const given = linear(calls, ["personal", "implement"]);

        const report = await runTransition(
            { source: "linear", id: "DOT-110" },
            modeDeps(given),
            STARTED,
        );

        expect(report.reasons).toEqual([
            "linear DOT-110 in implement has no autonomy: expected one of AFK, HITL",
        ]);
        expect(writes(calls)).toEqual([]);
    });
});

describe("transition: The autonomy decides whether leaving verify needs an answer", () => {
    it("AFK task: applied with no question, work, AFK, verify → work, AFK, code-review", async () => {
        const calls: string[] = [];
        const given = linear(calls, ["work", "AFK", "verify"]);

        const { state, tools } = await guarded("linear", "DOT-110");
        const report = await runTransition(
            { source: "linear", id: "DOT-110" },
            modeDeps(given, config(), state, tools),
            STARTED,
        );

        expect(report.applied).toBe(true);
        expect(report).not.toHaveProperty("handoff");
        expect(await labelsOf(given, "linear", "DOT-110")).toEqual(["work", "AFK", "code-review"]);
    });

    it("HITL task not approved: Later sends no answer, so the task keeps verify and nothing is written", async () => {
        const calls: string[] = [];
        const given = linear(calls, ["HITL", "verify"]);

        const { state, tools } = await guarded("linear", "DOT-110");
        const report = await runTransition(
            { source: "linear", id: "DOT-110" },
            modeDeps(given, config(), state, tools),
            STARTED,
        );
        const later = report.handoff?.questions[0]?.options.find(
            (option) => option.label === "Later",
        );

        expect(later?.value).toBeNull();
        expect(writes(calls)).toEqual([]);
        expect(await labelsOf(given, "linear", "DOT-110")).toEqual(["HITL", "verify"]);
    });

    it("Autonomy missing: personal and verify only, nothing is written and the reason names the missing autonomy", async () => {
        const calls: string[] = [];
        const given = linear(calls, ["personal", "verify"]);

        const report = await runTransition(
            { source: "linear", id: "DOT-110" },
            modeDeps(given),
            STARTED,
        );

        expect(report.reasons).toEqual([
            "linear DOT-110 in verify has no autonomy: expected one of AFK, HITL",
        ]);
        expect(writes(calls)).toEqual([]);
    });
});

describe("transition receipt: The transition waits for the persistence receipt", () => {
    const states: string[] = [];
    const ID = attemptId({ source: "linear", id: "DOT-110" }, "grill-me", 1);

    afterEach(() => {
        for (const state of states.splice(0)) {
            rmSync(state, { recursive: true, force: true });
        }
    });

    async function stateWith(...attempts: Partial<AttemptRecord>[]): Promise<string> {
        const state = tempState();
        states.push(state);
        for (const attempt of attempts) {
            await writeRecord(state, grillMe(attempt));
        }
        return state;
    }

    function grillMe(overrides: Partial<AttemptRecord> = {}): AttemptRecord {
        return startedAttempt({
            id: ID,
            task: { source: "linear", id: "DOT-110", title: "Grill-me stage" },
            stage: "grill-me",
            ...overrides,
        });
    }

    const receiptOf = (state: string, id = ID) => receiptPath(attemptDir(state, id));

    async function persisted(state: string, id = ID): Promise<void> {
        await writeJsonAtomic(receiptOf(state, id), { schema: "autonomous.persisted.v1" });
    }

    const missing = (state: string, id = ID) =>
        `grill-me attempt ${id} has no persistence receipt at ${receiptOf(state, id)}; ` +
        `persist its definition with --apply --persist ${id}, or discard the attempt`;

    async function report(given: Trackers, state: string) {
        return runTransition(
            { source: "linear", id: "DOT-110" },
            modeDeps(given, config(), state),
            STARTED,
        );
    }

    async function answered(given: Trackers, state: string): Promise<AnswerRecord> {
        const [only] = await transitionHandler(state, NO_TOOLS).answer(
            [answer("transition:linear:DOT-110", "AFK")],
            context(given),
        );
        if (only === undefined) {
            throw new Error("no record");
        }
        return only;
    }

    it("Definition not persisted: the report names the attempt and the receipt, has no handoff and exits 3", async () => {
        const calls: string[] = [];
        const given = linear(calls, ["personal", "grill-me"]);
        const state = await stateWith({});

        const result = await report(given, state);

        expect(result).toMatchObject({
            outcome: "not-evaluable",
            task: { source: "linear", id: "DOT-110", labels: ["personal", "grill-me"] },
            reasons: [missing(state)],
        });
        expect(result).not.toHaveProperty("handoff");
        expect(exitCodeFor(result.outcome)).toBe(3);
        expect(renderTransitionText(result)).toContain(`  - ${missing(state)}`);
        expect(calls).toEqual(["linear:readTask:DOT-110"]);
    });

    it("Definition not persisted: the answer is rejected, naming the attempt, and nothing is written", async () => {
        const calls: string[] = [];
        const given = linear(calls, ["work", "grill-me"]);
        const state = await stateWith({});

        const result = await answered(given, state);

        expect(result).toEqual({
            id: "transition:linear:DOT-110",
            labels: ["AFK"],
            status: "rejected",
            detail: missing(state),
        });
        expect(calls).toEqual(["linear:readTask:DOT-110"]);
        expect(await labelsOf(given, "linear", "DOT-110")).toEqual(["work", "grill-me"]);
    });

    it("Definition persisted: transition mode emits its question as before", async () => {
        const given = linear([], ["personal", "grill-me"]);
        const state = await stateWith({});
        await persisted(state);

        const result = await report(given, state);

        expect(result.outcome).toBe("advance");
        expect(result.reasons).toEqual([]);
        expect(result.handoff?.questions.map((question) => question.id)).toEqual([
            "transition:linear:DOT-110",
        ]);
        expect(exitCodeFor(result.outcome)).toBe(0);
    });

    it("Definition persisted: the answer is applied as before", async () => {
        const given = linear([], ["work", "grill-me"]);
        const state = await stateWith({});
        await persisted(state);

        const result = await answered(given, state);

        expect(result).toMatchObject({
            status: "applied",
            detail: "added AFK, proposal, removed grill-me on linear DOT-110, read back",
        });
        expect(await labelsOf(given, "linear", "DOT-110")).toEqual(["work", "AFK", "proposal"]);
    });

    it("Manual transition: no state directory means no open attempt and nothing is checked", async () => {
        const given = linear([], ["personal", "grill-me"]);
        const state = join(tmpdir(), "autonomous-transition-absent-state");

        const result = await report(given, state);
        const settled = await answered(linear([], ["work", "grill-me"]), state);

        expect(result.outcome).toBe("advance");
        expect(settled.status).toBe("applied");
    });

    it("Manual transition: a state directory with no attempt of the task asks the question", async () => {
        const other = attemptId({ source: "linear", id: "DOT-999" }, "grill-me", 1);
        const state = await stateWith({
            id: other,
            task: { source: "linear", id: "DOT-999", title: "Another task" },
        });

        const result = await report(linear([], ["personal", "grill-me"]), state);

        expect(result.outcome).toBe("advance");
    });

    it.each<[string, Partial<AttemptRecord>]>([
        ["discarded", { state: "discarded" }],
        ["aborted", { state: "aborted" }],
        ["completed with nothing to clean up", { state: "completed", cleanup: null }],
        [
            "of another stage",
            {
                id: attemptId({ source: "linear", id: "DOT-110" }, "proposal", 1),
                stage: "proposal",
            },
        ],
    ])(
        "Manual transition: an attempt that is %s does not hold the task",
        async (_name, attempt) => {
            const state = await stateWith(attempt);

            const result = await report(linear([], ["personal", "grill-me"]), state);
            const settled = await answered(linear([], ["work", "grill-me"]), state);

            expect(result.outcome).toBe("advance");
            expect(settled.status).toBe("applied");
        },
    );

    it.each<[string, Partial<AttemptRecord>]>([
        ["pending", { state: "pending" }],
        ["created", { state: "created" }],
        ["retained", { state: "retained" }],
        [
            "completed with a cleanup owed",
            { state: "completed", cleanup: { pending: true, error: "aoe remove failed" } },
        ],
    ])("an attempt that is %s holds the task until its receipt exists", async (_name, attempt) => {
        const state = await stateWith(attempt);

        const waiting = await report(linear([], ["personal", "grill-me"]), state);
        expect(waiting.reasons).toEqual([missing(state)]);
        expect(waiting).not.toHaveProperty("handoff");

        await persisted(state);
        const released = await report(linear([], ["personal", "grill-me"]), state);
        expect(released.outcome).toBe("advance");
    });

    it("the first open attempt without a receipt is named when an earlier one has its own", async () => {
        const first = attemptId({ source: "linear", id: "DOT-110" }, "grill-me", 1);
        const second = attemptId({ source: "linear", id: "DOT-110" }, "grill-me", 2);
        const state = await stateWith({}, { id: second, attempt: 2 });
        await persisted(state, first);

        const result = await report(linear([], ["personal", "grill-me"]), state);

        expect(result.reasons).toEqual([missing(state, second)]);
    });

    it("a task in none of the stages is reported as such, whatever its attempts hold", async () => {
        const state = await stateWith({});

        const result = await report(linear([], ["personal", "AFK", "wrap-up"]), state);
        const skipped = await answered(linear([], ["work", "AFK", "wrap-up"]), state);

        expect(result.reasons).toEqual([
            "linear DOT-110 is in none of grill-me, proposal, implement, verify, code-review and external-review (labels [personal, AFK, wrap-up])",
        ]);
        expect(skipped.status).toBe("skipped");
    });

    describe("leaving proposal", () => {
        const PROPOSAL = attemptId({ source: "linear", id: "DOT-110" }, "proposal", 1);

        const proposing = (overrides: Partial<AttemptRecord> = {}) =>
            stateWith({ id: PROPOSAL, stage: "proposal", ...overrides });

        const unsaved = (state: string) =>
            `proposal attempt ${PROPOSAL} has no persistence receipt at ${receiptOf(state, PROPOSAL)}; ` +
            `persist its stage summary with --apply --persist ${PROPOSAL}, or discard the attempt`;

        it("Stage summary not persisted: nothing is written, the report names the attempt and the receipt, exit 3", async () => {
            const calls: string[] = [];
            const given = linear(calls, ["personal", "AFK", "proposal"]);
            const state = await proposing();

            const result = await report(given, state);

            expect(result).toMatchObject({
                outcome: "not-evaluable",
                applied: false,
                reasons: [unsaved(state)],
            });
            expect(result).not.toHaveProperty("handoff");
            expect(exitCodeFor(result.outcome)).toBe(3);
            expect(calls).toEqual(["linear:readTask:DOT-110"]);
        });

        it("Stage summary not persisted: the approval is rejected, naming the attempt", async () => {
            const calls: string[] = [];
            const given = linear(calls, ["personal", "HITL", "proposal"]);
            const state = await proposing();

            const [only] = await transitionHandler(state, NO_TOOLS).answer(
                [answer("transition:linear:DOT-110", "implement")],
                context(given),
            );

            expect(only).toMatchObject({ status: "rejected", detail: unsaved(state) });
            expect(calls).toEqual(["linear:readTask:DOT-110"]);
        });

        it("Stage summary persisted: the AFK task moves to implement", async () => {
            const given = linear([], ["personal", "AFK", "proposal"]);
            const state = await proposing();
            await persisted(state, PROPOSAL);

            const result = await report(given, state);

            expect(result).toMatchObject({ outcome: "advance", applied: true });
        });

        it("an open grill-me attempt without a receipt does not hold a task in proposal", async () => {
            const given = linear([], ["personal", "AFK", "proposal"]);
            const state = await stateWith({});

            const result = await report(given, state);

            expect(result.applied).toBe(true);
        });
    });

    describe("leaving implement", () => {
        const IMPLEMENT = attemptId({ source: "linear", id: "DOT-110" }, "implement", 1);

        const unsaved = (state: string) =>
            `implement attempt ${IMPLEMENT} has no persistence receipt at ${receiptOf(state, IMPLEMENT)}; ` +
            `persist its stage summary with --apply --persist ${IMPLEMENT}, or discard the attempt`;

        it("Implementation summary not persisted: nothing is written, the report names the attempt and the receipt, exit 3", async () => {
            const calls: string[] = [];
            const given = linear(calls, ["personal", "AFK", "implement"]);
            const state = await stateWith({ id: IMPLEMENT, stage: "implement" });

            const result = await report(given, state);

            expect(result).toMatchObject({
                outcome: "not-evaluable",
                applied: false,
                reasons: [unsaved(state)],
            });
            expect(result).not.toHaveProperty("handoff");
            expect(exitCodeFor(result.outcome)).toBe(3);
            expect(calls).toEqual(["linear:readTask:DOT-110"]);
        });

        it("Implementation summary not persisted: the approval is rejected, naming the attempt", async () => {
            const calls: string[] = [];
            const given = linear(calls, ["personal", "HITL", "implement"]);
            const state = await stateWith({ id: IMPLEMENT, stage: "implement" });

            const [only] = await transitionHandler(state, NO_TOOLS).answer(
                [answer("transition:linear:DOT-110", "verify")],
                context(given),
            );

            expect(only).toMatchObject({ status: "rejected", detail: unsaved(state) });
            expect(calls).toEqual(["linear:readTask:DOT-110"]);
        });

        it("Implementation summary persisted: the AFK task moves to verify", async () => {
            const given = linear([], ["personal", "AFK", "implement"]);
            const state = await stateWith({
                id: IMPLEMENT,
                stage: "implement",
                workspace: { ...grillMe().workspace, path: workspaceDir() },
            });
            await persisted(state, IMPLEMENT);

            const result = await runTransition(
                { source: "linear", id: "DOT-110" },
                modeDeps(given, config(), state, workTools()),
                STARTED,
            );

            expect(result).toMatchObject({ outcome: "advance", applied: true });
        });
    });

    describe("leaving verify", () => {
        const VERIFY = attemptId({ source: "linear", id: "DOT-110" }, "verify", 1);

        it("Verification summary not persisted: nothing is written, the report names the attempt and the receipt, exit 3", async () => {
            const calls: string[] = [];
            const given = linear(calls, ["personal", "AFK", "verify"]);
            const state = await stateWith({ id: VERIFY, stage: "verify" });

            const result = await report(given, state);

            expect(result).toMatchObject({
                outcome: "not-evaluable",
                applied: false,
                reasons: [
                    `verify attempt ${VERIFY} has no persistence receipt at ${receiptOf(state, VERIFY)}; ` +
                        `persist its stage summary with --apply --persist ${VERIFY}, or discard the attempt`,
                ],
            });
            expect(result).not.toHaveProperty("handoff");
            expect(exitCodeFor(result.outcome)).toBe(3);
            expect(calls).toEqual(["linear:readTask:DOT-110"]);
        });

        it("Verification summary persisted: the AFK task moves to code-review", async () => {
            const given = linear([], ["personal", "AFK", "verify"]);
            const state = await stateWith({
                id: VERIFY,
                stage: "verify",
                workspace: { ...grillMe().workspace, path: workspaceDir() },
            });
            await persisted(state, VERIFY);

            const result = await runTransition(
                { source: "linear", id: "DOT-110" },
                modeDeps(given, config(), state, workTools()),
                STARTED,
            );

            expect(result).toMatchObject({ outcome: "advance", applied: true });
        });
    });

    it("a GitHub task is found in its nested attempt directory", async () => {
        const github = attemptId({ source: "github", id: "owner/repo#7" }, "grill-me", 1);
        const state = await stateWith({
            id: github,
            task: { source: "github", id: "owner/repo#7", title: "Grill it" },
        });
        const given = trackers([], {
            github: [task("github", "owner/repo#7", ["work", "grill-me"])],
        });

        const result = await runTransition(
            { source: "github", id: "owner/repo#7" },
            modeDeps(given, config(), state),
            STARTED,
        );

        expect(result.reasons).toEqual([missing(state, github)]);
        expect(result).not.toHaveProperty("handoff");
    });

    it("an unreadable attempt record is a reason, not a crash, and the answer fails", async () => {
        const state = await stateWith({});
        writeFileSync(recordPath(attemptDir(state, ID)), "not json");

        const result = await report(linear([], ["personal", "grill-me"]), state);
        const failed = await answered(linear([], ["work", "grill-me"]), state);

        expect(result.outcome).toBe("not-evaluable");
        expect(result.reasons).toHaveLength(1);
        expect(result.reasons[0]).toContain("is not valid JSON");
        expect(result).not.toHaveProperty("handoff");
        expect(failed.status).toBe("failed");
        expect(failed.detail).toContain("is not valid JSON");
    });

    it("answer mode routes a transition id through the receipt check", async () => {
        const given = linear([], ["personal", "grill-me"]);
        const state = await stateWith({});

        const result = await applyAnswers(
            [transitionHandler(state, NO_TOOLS)],
            [answer("transition:linear:DOT-110", "AFK")],
            context(given),
            STARTED,
        );

        expect(result.outcome).toBe("not-evaluable");
        expect(result.answers).toEqual([
            {
                id: "transition:linear:DOT-110",
                labels: ["AFK"],
                status: "rejected",
                detail: missing(state),
            },
        ]);
    });
});

describe("transition record: An applied transition leaves a record in the open attempt", () => {
    const states: string[] = [];
    const TASK = { source: "linear", id: "DOT-110", title: "Grill-me stage" } as const;
    const ID = attemptId(TASK, "grill-me", 1);
    const AT = new Date("2026-11-13T10:40:00.000Z");
    const ANSWER = "transition:linear:DOT-110";

    afterEach(() => {
        for (const state of states.splice(0)) {
            rmSync(state, { recursive: true, force: true });
        }
    });

    async function grilling(overrides: Partial<AttemptRecord> = {}): Promise<string> {
        const state = tempState();
        states.push(state);
        const started = startedAttempt({ id: ID, task: TASK, stage: "grill-me", ...overrides });
        await writeRecord(state, started);
        await writeJsonAtomic(receiptPath(attemptDir(state, started.id)), {
            schema: "autonomous.persisted.v1",
        });
        return state;
    }

    async function answered(
        state: string,
        labels: string[],
        value: string[] = ["HITL"],
    ): Promise<AnswerRecord> {
        const [only] = await transitionHandler(state, NO_TOOLS, undefined, () => AT).answer(
            [answer(ANSWER, ...value)],
            context(linear([], labels)),
        );
        if (only === undefined) {
            throw new Error("no record");
        }
        return only;
    }

    const recordIn = (state: string, id = ID) => readTransitioned(attemptDir(state, id));

    it("Autonomy answered in a grill: the attempt's directory holds the answer and its time", async () => {
        const state = await grilling();

        const settled = await answered(state, ["work", "grill-me"]);

        expect(settled).toEqual({
            id: ANSWER,
            labels: ["HITL"],
            status: "applied",
            detail: "added HITL, proposal, removed grill-me on linear DOT-110, read back",
        });
        expect(await recordIn(state)).toEqual({
            ok: true,
            value: {
                schema: TRANSITIONED_SCHEMA,
                answer: ["HITL"],
                at: AT.toISOString(),
                by: "human",
            },
        });
    });

    it("takes the clock from the handler, the real one by default", async () => {
        const state = await grilling();
        const before = Date.now();

        const [only] = await transitionHandler(state, NO_TOOLS).answer(
            [answer(ANSWER, "HITL")],
            context(linear([], ["work", "grill-me"])),
        );

        const read = await recordIn(state);
        expect(only?.status).toBe("applied");
        expect(read.ok && read.value !== null && Date.parse(read.value.at)).toBeGreaterThanOrEqual(
            before,
        );
    });

    it("an open attempt of another stage is left without a record", async () => {
        const state = tempState();
        states.push(state);
        const proposal = attemptId(TASK, "proposal", 1);
        await writeRecord(state, startedAttempt({ id: proposal, task: TASK, stage: "proposal" }));

        const settled = await answered(state, ["work", "grill-me"]);

        expect(settled.status).toBe("applied");
        expect(existsSync(transitionedPath(attemptDir(state, proposal)))).toBe(false);
    });

    it("several open attempts: the first of the sorted list gets it", async () => {
        const state = await grilling();
        const second = attemptId(TASK, "grill-me", 2);
        await writeRecord(
            state,
            startedAttempt({ id: second, task: TASK, stage: "grill-me", attempt: 2 }),
        );
        await writeJsonAtomic(receiptPath(attemptDir(state, second)), {});

        await answered(state, ["work", "grill-me"]);

        expect(existsSync(transitionedPath(attemptDir(state, ID)))).toBe(true);
        expect(existsSync(transitionedPath(attemptDir(state, second)))).toBe(false);
    });

    it("Manual transition: a task with no open attempt leaves no file and the answer is applied", async () => {
        const state = await grilling({ state: "discarded" });

        const settled = await answered(state, ["work", "grill-me"]);

        expect(settled).toMatchObject({
            status: "applied",
            detail: "added HITL, proposal, removed grill-me on linear DOT-110, read back",
        });
        expect(existsSync(transitionedPath(attemptDir(state, ID)))).toBe(false);
    });

    it("an attempt of another task is not the task's open attempt", async () => {
        const other = { source: "linear", id: "DOT-999", title: "Another" } as const;
        const state = tempState();
        states.push(state);
        const otherId = attemptId(other, "grill-me", 1);
        await writeRecord(state, startedAttempt({ id: otherId, task: other, stage: "grill-me" }));

        await answered(state, ["work", "grill-me"]);

        expect(existsSync(transitionedPath(attemptDir(state, otherId)))).toBe(false);
    });

    // Later is the option whose value is null: the command drops it and sends no answer (commands/run.md),
    // so the handler never sees one. The closest real path is "Later" reaching it as a value, which
    // is rejected before any label or file is written.
    it("Later: an answer of Later is rejected and no record is written", async () => {
        const state = await grilling();

        const settled = await answered(state, ["work", "grill-me"], ["Later"]);

        expect(settled.status).toBe("rejected");
        expect(existsSync(transitionedPath(attemptDir(state, ID)))).toBe(false);
    });

    it("a transition that is skipped or failed writes no record", async () => {
        const state = await grilling();

        const skipped = await answered(state, ["personal", "AFK", "proposal"]);
        const failed = await transitionHandler(state, NO_TOOLS, undefined, () => AT).answer(
            [answer(ANSWER, "HITL")],
            context(failingRemoval(linear([], ["work", "grill-me"]), "linear", "grill-me", "boom")),
        );

        expect(skipped.status).toBe("skipped");
        expect(failed[0]?.status).toBe("failed");
        expect(existsSync(transitionedPath(attemptDir(state, ID)))).toBe(false);
    });

    it("a failure to write is added to the detail and the status stays applied", async () => {
        const state = await grilling();
        mkdirSync(transitionedPath(attemptDir(state, ID))); // a directory where the file goes

        const settled = await answered(state, ["work", "grill-me"]);

        expect(settled.status).toBe("applied");
        expect(settled.detail).toMatch(
            /^added HITL, proposal, removed grill-me on linear DOT-110, read back; .+/,
        );
    });
});

describe("transition record: leaving proposal", () => {
    const states: string[] = [];
    const TASK = { source: "linear", id: "DOT-110", title: "Grill-me stage" } as const;
    const GRILL = attemptId(TASK, "grill-me", 1);
    const PROPOSAL = attemptId(TASK, "proposal", 1);
    const AT = new Date("2026-11-14T08:00:00.000Z");

    afterEach(() => {
        for (const state of states.splice(0)) {
            rmSync(state, { recursive: true, force: true });
        }
    });

    // A finished grill still owed its cleanup sorts before the proposal attempt.
    async function proposing(): Promise<string> {
        const state = tempState();
        states.push(state);
        await writeRecord(
            state,
            startedAttempt({
                id: GRILL,
                task: TASK,
                stage: "grill-me",
                state: "completed",
                cleanup: { pending: true, error: "aoe remove failed" },
            }),
        );
        await writeRecord(state, startedAttempt({ id: PROPOSAL, task: TASK, stage: "proposal" }));
        await writeJsonAtomic(receiptPath(attemptDir(state, PROPOSAL)), {});
        return state;
    }

    it("an AFK transition leaves implement, by the agent, in the proposal attempt", async () => {
        const state = await proposing();

        const report = await runTransition(
            { source: "linear", id: "DOT-110" },
            {
                ...modeDeps(linear([], ["work", "AFK", "proposal"]), config(), state),
                now: () => AT,
            },
            STARTED,
        );

        expect(report.applied).toBe(true);
        expect(await readTransitioned(attemptDir(state, PROPOSAL))).toEqual({
            ok: true,
            value: {
                schema: TRANSITIONED_SCHEMA,
                answer: ["implement"],
                at: AT.toISOString(),
                by: "agent",
            },
        });
        expect(existsSync(transitionedPath(attemptDir(state, GRILL)))).toBe(false);
    });

    it("an approval leaves implement, by the human, in the proposal attempt", async () => {
        const state = await proposing();

        const [only] = await transitionHandler(state, NO_TOOLS, undefined, () => AT).answer(
            [answer("transition:linear:DOT-110", "implement")],
            context(linear([], ["work", "HITL", "proposal"])),
        );

        expect(only?.status).toBe("applied");
        expect(await readTransitioned(attemptDir(state, PROPOSAL))).toMatchObject({
            ok: true,
            value: { answer: ["implement"], by: "human" },
        });
        expect(existsSync(transitionedPath(attemptDir(state, GRILL)))).toBe(false);
    });
});

describe("transition record: readTransitioned", () => {
    let dir: string;

    afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
    });

    const given = (text?: string) => {
        dir = tempState();
        if (text !== undefined) {
            writeFileSync(transitionedPath(dir), text);
        }
        return readTransitioned(dir);
    };

    it("is null when the file is absent", async () => {
        expect(await given()).toEqual({ ok: true, value: null });
    });

    it.each<[string, string, string]>([
        ["not JSON", "{ nope", "is not valid JSON"],
        ["another schema", JSON.stringify({ schema: "v2", answer: [], at: "x" }), "$.schema"],
        [
            "an unknown key",
            JSON.stringify({ schema: TRANSITIONED_SCHEMA, answer: [], at: "x", extra: 1 }),
            "$.extra",
        ],
        [
            "a non-string answer",
            JSON.stringify({ schema: TRANSITIONED_SCHEMA, answer: [1], at: "x" }),
            "$.answer[0] must be a string",
        ],
        ["no time", JSON.stringify({ schema: TRANSITIONED_SCHEMA, answer: [] }), "$.at"],
        [
            "an unknown decider",
            JSON.stringify({ schema: TRANSITIONED_SCHEMA, answer: [], at: "x", by: "bot" }),
            "$.by must be agent or human",
        ],
    ])("is an error naming the file for %s", async (_name, text, reason) => {
        const read = await given(text);

        expect(read.ok).toBe(false);
        expect(!read.ok && read.error).toContain(transitionedPath(dir));
        expect(!read.ok && read.error).toContain(reason);
    });

    it("reads a record written before by existed, and one that names who decided", async () => {
        const old = await given(
            JSON.stringify({ schema: TRANSITIONED_SCHEMA, answer: ["AFK"], at: "x" }),
        );
        expect(old).toEqual({
            ok: true,
            value: { schema: TRANSITIONED_SCHEMA, answer: ["AFK"], at: "x" },
        });
        rmSync(dir, { recursive: true, force: true });

        const agent = await given(
            JSON.stringify({
                schema: TRANSITIONED_SCHEMA,
                answer: ["implement"],
                at: "x",
                by: "agent",
            }),
        );
        expect(agent).toMatchObject({ ok: true, value: { by: "agent" } });
    });

    it("is an error naming the file when it cannot be read", async () => {
        dir = tempState();
        mkdirSync(transitionedPath(dir));

        const read = await readTransitioned(dir);

        expect(!read.ok && read.error).toContain(`cannot read ${transitionedPath(dir)}`);
    });
});

describe("transition guards: Leaving implement needs the work finished", () => {
    const REF = { source: "linear", id: "DOT-110" } as const;
    const ANSWER = "transition:linear:DOT-110";

    async function leaving(labels: string[], work: Work) {
        const calls: string[] = [];
        const given = linear(calls, labels);
        const { state, tools } = await guarded("linear", "DOT-110", work);
        const report = await runTransition(REF, modeDeps(given, config(), state, tools), STARTED);
        return { given, calls, report };
    }

    it("Unchecked task: the report names the change and the count, nothing is written, exit 3", async () => {
        const { given, calls, report } = await leaving(["personal", "AFK", "implement"], {
            completed: 11,
            total: 12,
        });

        expect(report).toMatchObject({
            outcome: "not-evaluable",
            applied: false,
            reasons: [`the change ${CHANGE} has 1 of 12 tasks unchecked`],
        });
        expect(report).not.toHaveProperty("handoff");
        expect(exitCodeFor(report.outcome)).toBe(3);
        expect(writes(calls)).toEqual([]);
        expect(await labelsOf(given, "linear", "DOT-110")).toEqual([
            "personal",
            "AFK",
            "implement",
        ]);
    });

    it("Uncommitted changes: an HITL task gets no approval question, the reason names them, exit 3", async () => {
        const { calls, report } = await leaving(["personal", "HITL", "implement"], {
            status: " M src/a.ts\n",
        });

        expect(report).toMatchObject({
            outcome: "not-evaluable",
            reasons: ["the working tree has 1 uncommitted change"],
        });
        expect(report).not.toHaveProperty("handoff");
        expect(exitCodeFor(report.outcome)).toBe(3);
        expect(writes(calls)).toEqual([]);
    });

    it("Unpushed commits: the answer verify is rejected, naming them, and the task keeps implement", async () => {
        const calls: string[] = [];
        const given = linear(calls, ["personal", "HITL", "implement"]);
        const { state, tools } = await guarded("linear", "DOT-110", { ahead: 2 });

        const [record] = await transitionHandler(state, tools).answer(
            [answer(ANSWER, "verify")],
            context(given),
        );

        expect(record).toEqual({
            id: ANSWER,
            labels: ["verify"],
            status: "rejected",
            detail: `implement is not finished: the branch ${BRANCH} has 2 commits origin/${BRANCH} lacks`,
        });
        expect(writes(calls)).toEqual([]);
        expect(await labelsOf(given, "linear", "DOT-110")).toEqual([
            "personal",
            "HITL",
            "implement",
        ]);
    });

    it("No workspace: transition mode writes nothing and the reason says there is none to check", async () => {
        const calls: string[] = [];
        const given = linear(calls, ["personal", "AFK", "implement"]);

        const report = await runTransition(REF, modeDeps(given), STARTED);

        expect(report.outcome).toBe("not-evaluable");
        expect(report.reasons).toEqual(["there is no workspace to check: the task has no attempt"]);
        expect(writes(calls)).toEqual([]);
    });

    it("No workspace: the answer is rejected and the task keeps implement", async () => {
        const calls: string[] = [];
        const given = linear(calls, ["personal", "HITL", "implement"]);

        const [record] = await transitionHandler(NO_STATE, NO_TOOLS).answer(
            [answer(ANSWER, "verify")],
            context(given),
        );

        expect(record).toMatchObject({
            status: "rejected",
            detail: "implement is not finished: there is no workspace to check: the task has no attempt",
        });
        expect(writes(calls)).toEqual([]);
    });

    it("the other stages never run the guards", async () => {
        const calls: string[] = [];
        const given = linear(calls, ["personal", "AFK", "proposal"]);

        const report = await runTransition(REF, modeDeps(given), STARTED);

        expect(report).toMatchObject({ outcome: "advance", applied: true });
    });
});

describe("transition guards: Leaving verify needs the work finished", () => {
    const REF = { source: "linear", id: "DOT-110" } as const;

    it("Uncommitted fix: the report names the uncommitted changes, nothing is written, exit 3", async () => {
        const calls: string[] = [];
        const given = linear(calls, ["personal", "AFK", "verify"]);
        const { state, tools } = await guarded("linear", "DOT-110", { status: " M src/a.ts\n" });

        const report = await runTransition(REF, modeDeps(given, config(), state, tools), STARTED);

        expect(report).toMatchObject({
            outcome: "not-evaluable",
            applied: false,
            reasons: ["the working tree has 1 uncommitted change"],
        });
        expect(exitCodeFor(report.outcome)).toBe(3);
        expect(writes(calls)).toEqual([]);
    });

    it("Unpushed fix: the answer code-review is rejected, naming the commit, and the task keeps verify", async () => {
        const calls: string[] = [];
        const given = linear(calls, ["personal", "HITL", "verify"]);
        const { state, tools } = await guarded("linear", "DOT-110", { ahead: 1 });

        const [record] = await transitionHandler(state, tools).answer(
            [answer("transition:linear:DOT-110", "code-review")],
            context(given),
        );

        expect(record).toEqual({
            id: "transition:linear:DOT-110",
            labels: ["code-review"],
            status: "rejected",
            detail: `verify is not finished: the branch ${BRANCH} has 1 commit origin/${BRANCH} lacks`,
        });
        expect(writes(calls)).toEqual([]);
        expect(await labelsOf(given, "linear", "DOT-110")).toEqual(["personal", "HITL", "verify"]);
    });
});

async function reviewing(
    source: Source,
    id: string,
    reviewed: Reviewed = {},
    work: Work = {},
): Promise<{ state: string; tools: GuardTools; attempt: string; dir: string }> {
    const made = await stateInReview({ source, id }, reviewed);
    kept.push(made.state, made.workspace);
    return { ...made, tools: workTools(work) };
}

const REF = { source: "linear", id: "DOT-110" } as const;

describe("transition mode: code-review", () => {
    it("AFK task in code-review: external-review replaces code-review, applied, no handoff and exit 0", async () => {
        const calls: string[] = [];
        const given = linear(calls, ["personal", "AFK", "code-review"]);
        const { state, tools } = await reviewing("linear", "DOT-110");

        const report = await runTransition(REF, modeDeps(given, config(), state, tools), STARTED);

        expect(report).toMatchObject({ outcome: "advance", applied: true, reasons: [] });
        expect(report.task?.labels).toEqual(["personal", "AFK", "external-review"]);
        expect(report).not.toHaveProperty("handoff");
        expect(exitCodeFor(report.outcome)).toBe(0);
        expect(writes(calls)).toEqual([
            "linear:addLabel:DOT-110:external-review",
            "linear:removeLabel:DOT-110:code-review",
        ]);
        expect(await labelsOf(given, "linear", "DOT-110")).toEqual([
            "personal",
            "AFK",
            "external-review",
        ]);
    });

    it("HITL task in code-review: the approval question, nothing written and exit 0", async () => {
        const calls: string[] = [];
        const given = linear(calls, ["personal", "HITL", "code-review"]);
        const { state, tools } = await reviewing("linear", "DOT-110");

        const report = await runTransition(REF, modeDeps(given, config(), state, tools), STARTED);

        expect(report).toMatchObject({ outcome: "advance", applied: false, reasons: [] });
        expect(report.handoff?.questions.map(({ id, options }) => ({ id, options }))).toEqual([
            {
                id: "transition:linear:DOT-110",
                options: [
                    {
                        label: "Approve",
                        value: "external-review",
                        description: "Move the task to external-review",
                    },
                    { label: "Later", value: null, description: "Leave the task in code-review" },
                ],
            },
        ]);
        expect(exitCodeFor(report.outcome)).toBe(0);
        expect(calls).toEqual(["linear:readTask:DOT-110"]);
    });

    it("HITL task in code-review with failed checks: refused naming each, no question and exit 3", async () => {
        const calls: string[] = [];
        const given = linear(calls, ["personal", "HITL", "code-review"]);
        const failing = [
            checkRun("main", { conclusion: "failure" }),
            checkRun("lint", { conclusion: "timed_out" }),
        ];
        const { state, tools } = await reviewing("linear", "DOT-110", {}, { checkRuns: failing });

        const report = await runTransition(REF, modeDeps(given, config(), state, tools), STARTED);

        expect(report).toMatchObject({
            outcome: "not-evaluable",
            applied: false,
            reasons: [
                "the check main concluded failure on 0ddba11",
                "the check lint concluded timed_out on 0ddba11",
            ],
        });
        expect(report).not.toHaveProperty("handoff");
        expect(exitCodeFor(report.outcome)).toBe(3);
        expect(writes(calls)).toEqual([]);
    });

    it("HITL task in code-review with a running check: the approval question, exit 0", async () => {
        const calls: string[] = [];
        const given = linear(calls, ["personal", "HITL", "code-review"]);
        const running = [checkRun("main", { status: "in_progress", conclusion: null })];
        const { state, tools } = await reviewing("linear", "DOT-110", {}, { checkRuns: running });

        const report = await runTransition(REF, modeDeps(given, config(), state, tools), STARTED);

        expect(report).toMatchObject({ outcome: "advance", applied: false, reasons: [] });
        expect(report.handoff?.questions).toHaveLength(1);
        expect(exitCodeFor(report.outcome)).toBe(0);
    });

    it("external-review not bootstrapped: nothing is written, the reason names --bootstrap-labels and exit 3", async () => {
        const calls: string[] = [];
        const given = linear(calls, ["personal", "AFK", "code-review"], {
            labels: LINEAR_LABELS.filter((label) => label.name !== "external-review"),
        });
        const { state, tools } = await reviewing("linear", "DOT-110");

        const report = await runTransition(REF, modeDeps(given, config(), state, tools), STARTED);

        expect(report).toMatchObject({
            outcome: "not-evaluable",
            applied: false,
            reasons: ["external-review is missing on linear; run --bootstrap-labels"],
        });
        expect(report).not.toHaveProperty("handoff");
        expect(exitCodeFor(report.outcome)).toBe(3);
        expect(writes(calls)).toEqual([]);
    });
});

describe("transition mode: Approval question for code-review", () => {
    it("Code review ready: the question says so and Approve carries external-review", async () => {
        const given = trackers([], {
            linear: [task("linear", "DOT-110", ["personal", "HITL", "code-review"])],
        });
        const { state, tools } = await reviewing("linear", "DOT-110");

        const report = await runTransition(REF, modeDeps(given, config(), state, tools), STARTED);

        expect(report.handoff?.questions[0]).toEqual({
            id: "transition:linear:DOT-110",
            step: TRANSITION,
            header: "DOT-110",
            question: [
                'linear DOT-110 "Task DOT-110": the code review is ready. Approve it to move the task to external-review?',
                "Labels: [personal, HITL, code-review]",
            ].join("\n"),
            options: [
                {
                    label: "Approve",
                    value: "external-review",
                    description: "Move the task to external-review",
                },
                { label: "Later", value: null, description: "Leave the task in code-review" },
            ],
            multiSelect: false,
        });
    });
});

describe("transition answers: code-review", () => {
    it("Code review approved: personal, HITL, code-review + external-review → personal, HITL, external-review", async () => {
        const calls: string[] = [];
        const given = linear(calls, ["personal", "HITL", "code-review"]);
        const { state, tools } = await reviewing("linear", "DOT-110");

        const [record] = await transitionHandler(state, tools).answer(
            [answer("transition:linear:DOT-110", "external-review")],
            context(given),
        );

        expect(record).toEqual({
            id: "transition:linear:DOT-110",
            labels: ["external-review"],
            status: "applied",
            detail: "added external-review, removed code-review on linear DOT-110, read back",
        });
        expect(await labelsOf(given, "linear", "DOT-110")).toEqual([
            "personal",
            "HITL",
            "external-review",
        ]);
    });

    it("an answer other than external-review for a task in code-review is skipped and nothing is written", async () => {
        const calls: string[] = [];
        const given = linear(calls, ["personal", "HITL", "code-review"]);

        const record = await transition(given, "transition:linear:DOT-110", "verify");

        expect(record).toMatchObject({
            status: "skipped",
            detail: "already moved on: stage [code-review]",
        });
        expect(writes(calls)).toEqual([]);
    });
});

describe("transition: A transition replaces the stage, code-review", () => {
    it("Code review done: personal, HITL, code-review → personal, HITL, external-review, and only code-review was removed", async () => {
        const calls: string[] = [];
        const given = trackers(calls, {
            beads: [task("beads", "X-12", ["personal", "HITL", "code-review"])],
        });
        const { state, tools } = await reviewing("beads", "X-12");

        const [record] = await transitionHandler(state, tools).answer(
            [answer("transition:beads:X-12", "external-review")],
            context(given),
        );

        expect(record?.status).toBe("applied");
        expect(writes(calls)).toEqual([
            "beads:addLabel:X-12:external-review",
            "beads:removeLabel:X-12:code-review",
        ]);
        expect(await labelsOf(given, "beads", "X-12")).toEqual([
            "personal",
            "HITL",
            "external-review",
        ]);
    });
});

describe("transition: The autonomy decides whether leaving code-review needs an answer", () => {
    it("AFK task: applied with no question, work, AFK, code-review → work, AFK, external-review", async () => {
        const given = linear([], ["work", "AFK", "code-review"]);
        const { state, tools } = await reviewing("linear", "DOT-110");

        const report = await runTransition(REF, modeDeps(given, config(), state, tools), STARTED);

        expect(report.applied).toBe(true);
        expect(report).not.toHaveProperty("handoff");
        expect(await labelsOf(given, "linear", "DOT-110")).toEqual([
            "work",
            "AFK",
            "external-review",
        ]);
    });

    it("HITL task not approved: Later sends no answer, so the task keeps code-review and nothing is written", async () => {
        const calls: string[] = [];
        const given = linear(calls, ["HITL", "code-review"]);
        const { state, tools } = await reviewing("linear", "DOT-110");

        const report = await runTransition(REF, modeDeps(given, config(), state, tools), STARTED);
        const later = report.handoff?.questions[0]?.options.find(
            (option) => option.label === "Later",
        );

        expect(later?.value).toBeNull();
        expect(writes(calls)).toEqual([]);
        expect(await labelsOf(given, "linear", "DOT-110")).toEqual(["HITL", "code-review"]);
    });

    it("Autonomy missing: personal and code-review only, nothing is written and the reason names the missing autonomy", async () => {
        const calls: string[] = [];
        const given = linear(calls, ["personal", "code-review"]);

        const report = await runTransition(REF, modeDeps(given), STARTED);

        expect(report.reasons).toEqual([
            "linear DOT-110 in code-review has no autonomy: expected one of AFK, HITL",
        ]);
        expect(writes(calls)).toEqual([]);
    });
});

describe("transition receipt: The transition waits for the persistence receipt, code-review", () => {
    it("Code review summary not persisted: nothing is written, the report names the attempt and the receipt, exit 3", async () => {
        const calls: string[] = [];
        const given = linear(calls, ["personal", "AFK", "code-review"]);
        const { state, tools, attempt } = await reviewing("linear", "DOT-110", {
            persisted: false,
        });

        const report = await runTransition(REF, modeDeps(given, config(), state, tools), STARTED);

        expect(report).toMatchObject({
            outcome: "not-evaluable",
            applied: false,
            reasons: [
                `code-review attempt ${attempt} has no persistence receipt at ${receiptPath(attemptDir(state, attemptId(REF, "code-review", 1)))}; ` +
                    `persist its stage summary with --apply --persist ${attempt}, or discard the attempt`,
            ],
        });
        expect(report).not.toHaveProperty("handoff");
        expect(exitCodeFor(report.outcome)).toBe(3);
        expect(calls).toEqual(["linear:readTask:DOT-110"]);
    });
});

describe("transition guards: Leaving code-review needs the work finished", () => {
    it("Uncommitted fix: the report names the uncommitted changes, nothing is written, exit 3", async () => {
        const calls: string[] = [];
        const given = linear(calls, ["personal", "AFK", "code-review"]);
        const { state, tools } = await reviewing(
            "linear",
            "DOT-110",
            {},
            { status: " M src/a.ts\n" },
        );

        const report = await runTransition(REF, modeDeps(given, config(), state, tools), STARTED);

        expect(report).toMatchObject({
            outcome: "not-evaluable",
            applied: false,
            reasons: ["the working tree has 1 uncommitted change"],
        });
        expect(exitCodeFor(report.outcome)).toBe(3);
        expect(writes(calls)).toEqual([]);
    });

    it("Unpushed fix: the answer external-review is rejected, naming the commit, and the task keeps code-review", async () => {
        const calls: string[] = [];
        const given = linear(calls, ["personal", "HITL", "code-review"]);
        const { state, tools } = await reviewing("linear", "DOT-110", {}, { ahead: 1 });

        const [record] = await transitionHandler(state, tools).answer(
            [answer("transition:linear:DOT-110", "external-review")],
            context(given),
        );

        expect(record).toEqual({
            id: "transition:linear:DOT-110",
            labels: ["external-review"],
            status: "rejected",
            detail: `code-review is not finished: the branch ${BRANCH} has 1 commit origin/${BRANCH} lacks`,
        });
        expect(writes(calls)).toEqual([]);
        expect(await labelsOf(given, "linear", "DOT-110")).toEqual([
            "personal",
            "HITL",
            "code-review",
        ]);
    });
});

describe("transition receipt: The transition waits for the publish receipt", () => {
    const ID = attemptId(REF, "code-review", 1);

    const notPublished = (suffix: string) =>
        `code-review attempt ${ID} ${suffix}, so its record is not published; ` +
        `publish it with --apply --publish ${ID}, or discard the attempt`;

    it("Never published: nothing is written, the report names the attempt and the missing receipt, exit 3", async () => {
        const calls: string[] = [];
        const given = linear(calls, ["personal", "AFK", "code-review"]);
        const { state, tools, dir } = await reviewing("linear", "DOT-110", { published: null });

        const report = await runTransition(REF, modeDeps(given, config(), state, tools), STARTED);

        expect(report).toMatchObject({
            outcome: "not-evaluable",
            applied: false,
            reasons: [notPublished(`has no publish receipt at ${join(dir, "published.json")}`)],
        });
        expect(report).not.toHaveProperty("handoff");
        expect(exitCodeFor(report.outcome)).toBe(3);
        expect(calls).toEqual(["linear:readTask:DOT-110"]);
    });

    it("Record changed after publishing: the answer is rejected, naming the attempt, and the task keeps code-review", async () => {
        const calls: string[] = [];
        const given = linear(calls, ["personal", "HITL", "code-review"]);
        const { state, tools } = await reviewing("linear", "DOT-110", {
            findings: `${FINDINGS.trim()}\n\n`,
        });

        const [record] = await transitionHandler(state, tools).answer(
            [answer("transition:linear:DOT-110", "external-review")],
            context(given),
        );

        expect(record).toEqual({
            id: "transition:linear:DOT-110",
            labels: ["external-review"],
            status: "rejected",
            detail: notPublished("has a findings.json that differs from the one published"),
        });
        expect(writes(calls)).toEqual([]);
    });

    it("a record that was removed after publishing differs from the one published", async () => {
        const given = linear([], ["personal", "AFK", "code-review"]);
        const { state, tools } = await reviewing("linear", "DOT-110", { findings: null });

        const report = await runTransition(REF, modeDeps(given, config(), state, tools), STARTED);

        expect(report.reasons).toEqual([
            notPublished("has a findings.json that differs from the one published"),
        ]);
    });

    it("a receipt naming the digest of a record that is not there is published against nothing", async () => {
        const given = linear([], ["personal", "AFK", "code-review"]);
        const { state, tools } = await reviewing("linear", "DOT-110", {
            findings: null,
            published: digestOf(""),
        });

        const report = await runTransition(REF, modeDeps(given, config(), state, tools), STARTED);

        expect(report.outcome).toBe("not-evaluable");
        expect(report.reasons).toEqual([
            notPublished("has a findings.json that differs from the one published"),
        ]);
    });

    it("Published: the transition proceeds by the task's autonomy", async () => {
        const afk = linear([], ["personal", "AFK", "code-review"]);
        const hitl = linear([], ["personal", "HITL", "code-review"]);
        const { state, tools } = await reviewing("linear", "DOT-110");

        const applied = await runTransition(REF, modeDeps(afk, config(), state, tools), STARTED);
        const asked = await runTransition(REF, modeDeps(hitl, config(), state, tools), STARTED);

        expect(applied).toMatchObject({ outcome: "advance", applied: true });
        expect(asked).toMatchObject({ outcome: "advance", applied: false });
        expect(asked.handoff?.questions).toHaveLength(1);
    });

    it("the persistence receipt is checked first: an attempt with neither is reported for the summary", async () => {
        const given = linear([], ["personal", "AFK", "code-review"]);
        const { state, tools, attempt } = await reviewing("linear", "DOT-110", {
            persisted: false,
            published: null,
        });

        const report = await runTransition(REF, modeDeps(given, config(), state, tools), STARTED);

        expect(report.reasons).toHaveLength(1);
        expect(report.reasons[0]).toContain(`${attempt} has no persistence receipt`);
    });

    it("a task with no open attempt of the stage is transitioned without the check", async () => {
        const calls: string[] = [];
        const given = linear(calls, ["personal", "HITL", "code-review"]);
        const { state, tools } = await guarded("linear", "DOT-110");

        const [record] = await transitionHandler(state, tools).answer(
            [answer("transition:linear:DOT-110", "external-review")],
            context(given),
        );

        expect(record?.status).toBe("applied");
    });

    it("an attempt of the stage that is no longer open is not checked", async () => {
        const given = linear([], ["personal", "AFK", "code-review"]);
        const { state, workspace } = await stateWithWorkspace(REF, {
            id: ID,
            stage: "code-review",
        });
        kept.push(state, workspace);

        const report = await runTransition(
            REF,
            modeDeps(given, config(), state, workTools()),
            STARTED,
        );

        expect(report).toMatchObject({ outcome: "advance", applied: true });
    });

    it("a publish receipt that cannot be parsed is a reason, not a crash, and the answer is rejected", async () => {
        const given = linear([], ["personal", "HITL", "code-review"]);
        const { state, tools, dir } = await reviewing("linear", "DOT-110");
        writeFileSync(join(dir, "published.json"), "not json");

        const report = await runTransition(
            REF,
            modeDeps(linear([], ["personal", "AFK", "code-review"]), config(), state, tools),
            STARTED,
        );
        const [record] = await transitionHandler(state, tools).answer(
            [answer("transition:linear:DOT-110", "external-review")],
            context(given),
        );

        expect(report.outcome).toBe("not-evaluable");
        expect(report.reasons[0]).toContain("is not valid JSON");
        expect(record?.status).toBe("failed");
    });

    it("only a code review attempt waits for a publish receipt: a verify attempt with none passes", async () => {
        const given = linear([], ["personal", "AFK", "verify"]);
        const { state, workspace } = await stateWithWorkspace(REF, {
            id: attemptId(REF, "verify", 1),
            stage: "verify",
            state: "started",
        });
        kept.push(state, workspace);
        await writeJsonAtomic(receiptPath(attemptDir(state, attemptId(REF, "verify", 1))), {
            schema: "autonomous.persisted.v1",
        });

        const report = await runTransition(
            REF,
            modeDeps(given, config(), state, workTools()),
            STARTED,
        );

        expect(report).toMatchObject({ outcome: "advance", applied: true });
    });
});

// A task in external-review whose open attempt published a quiet round, as the stage leaves it.
function rounding(source: Source, id: string, reviewed: Reviewed = {}, work: Work = {}) {
    return reviewing(
        source,
        id,
        { stage: "external-review", attempt: 2, quiet: true, ...reviewed },
        work,
    );
}

const APPROVE = "transition:linear:DOT-110";

describe("transition mode: external-review", () => {
    it("AFK task in external-review: wrap-up replaces external-review, applied, no handoff and exit 0", async () => {
        const calls: string[] = [];
        const given = linear(calls, ["personal", "AFK", "external-review"]);
        const { state, tools } = await rounding("linear", "DOT-110");

        const report = await runTransition(REF, modeDeps(given, config(), state, tools), STARTED);

        expect(report).toMatchObject({ outcome: "advance", applied: true, reasons: [] });
        expect(report.task?.labels).toEqual(["personal", "AFK", "wrap-up"]);
        expect(report).not.toHaveProperty("handoff");
        expect(exitCodeFor(report.outcome)).toBe(0);
        expect(writes(calls)).toEqual([
            "linear:addLabel:DOT-110:wrap-up",
            "linear:removeLabel:DOT-110:external-review",
        ]);
    });

    it("HITL task in external-review: the approval question, nothing written and exit 0", async () => {
        const calls: string[] = [];
        const given = linear(calls, ["personal", "HITL", "external-review"]);
        const { state, tools } = await rounding("linear", "DOT-110");

        const report = await runTransition(REF, modeDeps(given, config(), state, tools), STARTED);

        expect(report).toMatchObject({ outcome: "advance", applied: false, reasons: [] });
        expect(report.handoff?.questions.map(({ id, options }) => ({ id, options }))).toEqual([
            {
                id: APPROVE,
                options: [
                    { label: "Approve", value: "wrap-up", description: "Move the task to wrap-up" },
                    {
                        label: "Later",
                        value: null,
                        description: "Leave the task in external-review",
                    },
                ],
            },
        ]);
        expect(exitCodeFor(report.outcome)).toBe(0);
        expect(calls).toEqual(["linear:readTask:DOT-110"]);
    });

    it("wrap-up not bootstrapped: nothing is written, the reason names --bootstrap-labels and exit 3", async () => {
        const calls: string[] = [];
        const given = linear(calls, ["personal", "AFK", "external-review"], {
            labels: LINEAR_LABELS.filter((label) => label.name !== "wrap-up"),
        });
        const { state, tools } = await rounding("linear", "DOT-110");

        const report = await runTransition(REF, modeDeps(given, config(), state, tools), STARTED);

        expect(report).toMatchObject({
            outcome: "not-evaluable",
            applied: false,
            reasons: ["wrap-up is missing on linear; run --bootstrap-labels"],
        });
        expect(exitCodeFor(report.outcome)).toBe(3);
        expect(writes(calls)).toEqual([]);
    });

    it("--from external-review names the stage the task is in: the transition is applied", async () => {
        const given = linear([], ["personal", "AFK", "external-review"]);
        const { state, tools } = await rounding("linear", "DOT-110");

        const report = await runTransition(
            REF,
            modeDeps(given, config(), state, tools),
            STARTED,
            "external-review",
        );

        expect(report).toMatchObject({ outcome: "advance", applied: true });
    });
});

describe("transition mode: Approval question for external-review", () => {
    it("External review ready: the question says so and Approve carries wrap-up", async () => {
        const given = trackers([], {
            linear: [task("linear", "DOT-110", ["personal", "HITL", "external-review"])],
        });
        const { state, tools } = await rounding("linear", "DOT-110");

        const report = await runTransition(REF, modeDeps(given, config(), state, tools), STARTED);
        const question = report.handoff?.questions[0];

        expect(question?.question.split("\n")[0]).toBe(
            'linear DOT-110 "Task DOT-110": the external review is ready. Approve it to move the task to wrap-up?',
        );
        expect(question?.options[0]).toEqual({
            label: "Approve",
            value: "wrap-up",
            description: "Move the task to wrap-up",
        });
    });
});

describe("transition answers: external-review", () => {
    it("External review approved: personal, HITL, external-review + wrap-up → personal, HITL, wrap-up", async () => {
        const calls: string[] = [];
        const given = linear(calls, ["personal", "HITL", "external-review"]);
        const { state, tools } = await rounding("linear", "DOT-110");

        const [record] = await transitionHandler(state, tools).answer(
            [answer(APPROVE, "wrap-up")],
            context(given),
        );

        expect(record).toEqual({
            id: APPROVE,
            labels: ["wrap-up"],
            status: "applied",
            detail: "added wrap-up, removed external-review on linear DOT-110, read back",
        });
        expect(await labelsOf(given, "linear", "DOT-110")).toEqual(["personal", "HITL", "wrap-up"]);
    });

    it("an answer other than wrap-up for a task in external-review is skipped and nothing is written", async () => {
        const calls: string[] = [];
        const given = linear(calls, ["personal", "HITL", "external-review"]);

        const record = await transition(given, APPROVE, "external-review");

        expect(record.status).toBe("skipped");
        expect(writes(calls)).toEqual([]);
    });

    it("Round not quiet: the answer wrap-up is rejected, naming the receipt, and the task keeps external-review", async () => {
        const calls: string[] = [];
        const given = linear(calls, ["personal", "HITL", "external-review"]);
        const { state, tools, attempt, dir } = await rounding("linear", "DOT-110", {
            quiet: false,
        });

        const [record] = await transitionHandler(state, tools).answer(
            [answer(APPROVE, "wrap-up")],
            context(given),
        );

        expect(record).toMatchObject({
            status: "rejected",
            detail:
                `external-review is not finished: external-review attempt ${attempt} has a publish receipt at ${join(dir, "published.json")} ` +
                "that is not a quiet round's, so the external review is not over; leave the task to its next round, or discard the attempt",
        });
        expect(writes(calls)).toEqual([]);
        expect(await labelsOf(given, "linear", "DOT-110")).toEqual([
            "personal",
            "HITL",
            "external-review",
        ]);
    });
});

describe("transition: A transition replaces the stage, external-review", () => {
    it("External review done: personal, HITL, external-review → personal, HITL, wrap-up, and only external-review was removed", async () => {
        const calls: string[] = [];
        const given = linear(calls, ["personal", "HITL", "external-review"]);
        const { state, tools } = await rounding("linear", "DOT-110");

        await transitionHandler(state, tools).answer([answer(APPROVE, "wrap-up")], context(given));

        expect(writes(calls)).toEqual([
            "linear:addLabel:DOT-110:wrap-up",
            "linear:removeLabel:DOT-110:external-review",
        ]);
        expect(await labelsOf(given, "linear", "DOT-110")).toEqual(["personal", "HITL", "wrap-up"]);
    });
});

describe("transition: The autonomy decides whether leaving external-review needs an answer", () => {
    it("AFK task: applied with no question, work, AFK, external-review → work, AFK, wrap-up", async () => {
        const given = linear([], ["work", "AFK", "external-review"]);
        const { state, tools } = await rounding("linear", "DOT-110");

        const report = await runTransition(REF, modeDeps(given, config(), state, tools), STARTED);

        expect(report.applied).toBe(true);
        expect(report).not.toHaveProperty("handoff");
        expect(await labelsOf(given, "linear", "DOT-110")).toEqual(["work", "AFK", "wrap-up"]);
    });

    it("HITL task not approved: Later sends no answer, so the task keeps external-review and nothing is written", async () => {
        const calls: string[] = [];
        const given = linear(calls, ["HITL", "external-review"]);
        const { state, tools } = await rounding("linear", "DOT-110");

        const report = await runTransition(REF, modeDeps(given, config(), state, tools), STARTED);
        const later = report.handoff?.questions[0]?.options.find(
            (option) => option.label === "Later",
        );

        expect(later?.value).toBeNull();
        expect(writes(calls)).toEqual([]);
        expect(await labelsOf(given, "linear", "DOT-110")).toEqual(["HITL", "external-review"]);
    });

    it("Autonomy missing: personal and external-review only, nothing is written and the reason names the missing autonomy", async () => {
        const calls: string[] = [];
        const given = linear(calls, ["personal", "external-review"]);

        const report = await runTransition(REF, modeDeps(given), STARTED);

        expect(report.reasons).toEqual([
            "linear DOT-110 in external-review has no autonomy: expected one of AFK, HITL",
        ]);
        expect(writes(calls)).toEqual([]);
    });
});

describe("transition receipt: The transition waits for the persistence receipt, external-review", () => {
    it("External review summary not persisted: nothing is written, the report names the attempt and the receipt, exit 3", async () => {
        const calls: string[] = [];
        const given = linear(calls, ["personal", "AFK", "external-review"]);
        const { state, tools, attempt, dir } = await rounding("linear", "DOT-110", {
            persisted: false,
        });

        const report = await runTransition(REF, modeDeps(given, config(), state, tools), STARTED);

        expect(attempt).toBe("linear:DOT-110:external-review:2");
        expect(report).toMatchObject({
            outcome: "not-evaluable",
            applied: false,
            reasons: [
                `external-review attempt ${attempt} has no persistence receipt at ${receiptPath(dir)}; ` +
                    `persist its stage summary with --apply --persist ${attempt}, or discard the attempt`,
            ],
        });
        expect(exitCodeFor(report.outcome)).toBe(3);
        expect(calls).toEqual(["linear:readTask:DOT-110"]);
    });
});

describe("transition guards: Leaving external-review needs a quiet round", () => {
    it("Check running: the report names audit, nothing is written, exit 3", async () => {
        const calls: string[] = [];
        const given = linear(calls, ["personal", "AFK", "external-review"]);
        const running = [checkRun("audit", { status: "in_progress", conclusion: null })];
        const { state, tools } = await rounding("linear", "DOT-110", {}, { checkRuns: running });

        const report = await runTransition(REF, modeDeps(given, config(), state, tools), STARTED);

        expect(report).toMatchObject({
            outcome: "not-evaluable",
            applied: false,
            reasons: ["the check audit has not ended on 0ddba11"],
        });
        expect(exitCodeFor(report.outcome)).toBe(3);
        expect(writes(calls)).toEqual([]);
    });

    it("Quiet and green: a current, quiet receipt, a persisted summary, finished work and passed checks", async () => {
        const given = linear([], ["personal", "AFK", "external-review"]);
        const { state, tools } = await rounding(
            "linear",
            "DOT-110",
            {},
            { checkRuns: [checkRun("main"), checkRun("CodeRabbit")] },
        );

        const report = await runTransition(REF, modeDeps(given, config(), state, tools), STARTED);

        expect(report).toMatchObject({ outcome: "advance", applied: true, reasons: [] });
    });
});

describe("transition: The transition into external-review marks the pull request ready", () => {
    const failing = [checkRun("main", { conclusion: "failure" })];

    it("Code review approved: a draft is marked ready for review before any label is written", async () => {
        const calls: string[] = [];
        const given = linear(calls, ["personal", "HITL", "code-review"]);
        const prCalls: string[] = [];
        const { state } = await reviewing("linear", "DOT-110");

        const [record] = await transitionHandler(state, workTools({ draft: true }, prCalls)).answer(
            [answer(APPROVE, "external-review")],
            context(given),
        );

        expect(record?.status).toBe("applied");
        expect(prCalls.filter((call) => call.startsWith("pr "))).toEqual([
            `pr find ${BRANCH}`,
            `pr state ${PULL_REQUEST}`,
            "pr checkRuns 0ddba11",
            `pr ready ${PULL_REQUEST}`,
        ]);
        expect(await labelsOf(given, "linear", "DOT-110")).toEqual([
            "personal",
            "HITL",
            "external-review",
        ]);
    });

    it("Marking fails: the task keeps code-review, the report names the failure, exit 3", async () => {
        const calls: string[] = [];
        const given = linear(calls, ["personal", "AFK", "code-review"]);
        const { state, tools } = await reviewing(
            "linear",
            "DOT-110",
            {},
            { draft: true, readyError: "gh pr ready: HTTP 502" },
        );

        const report = await runTransition(REF, modeDeps(given, config(), state, tools), STARTED);

        expect(report).toMatchObject({
            outcome: "not-evaluable",
            applied: false,
            reasons: [
                `marking pull request #${PULL_REQUEST} ready for review: gh pr ready: HTTP 502`,
            ],
        });
        expect(exitCodeFor(report.outcome)).toBe(3);
        expect(writes(calls)).toEqual([]);
        expect(await labelsOf(given, "linear", "DOT-110")).toEqual([
            "personal",
            "AFK",
            "code-review",
        ]);
    });

    it("Already ready: a pull request that is not a draft is unchanged and the transition is applied", async () => {
        const prCalls: string[] = [];
        const given = linear([], ["personal", "AFK", "code-review"]);
        const { state } = await reviewing("linear", "DOT-110");

        const report = await runTransition(
            REF,
            modeDeps(given, config(), state, workTools({}, prCalls)),
            STARTED,
        );

        expect(report).toMatchObject({ outcome: "advance", applied: true, reasons: [] });
        expect(prCalls).not.toContain(`pr ready ${PULL_REQUEST}`);
    });

    // The code review's own guards need its workspace, so only the apply step can meet a task
    // with none.
    it("No workspace on this machine: the labels are written, and the report says the pull request was not marked", async () => {
        const calls: string[] = [];
        const given = linear(calls, ["personal", "AFK", "code-review"]);

        const settled = await applyTransition({
            tracker: given.linear,
            ref: REF,
            row: transitionRow("code-review"),
            before: ["personal", "AFK", "code-review"],
            state: NO_STATE,
            tools: NO_TOOLS,
        });

        const unmarked =
            "the pull request was not marked ready for review: there is no workspace to check: the task has no attempt";
        expect(settled).toEqual({
            status: "applied",
            detail: `added external-review, removed code-review on linear DOT-110, read back; ${unmarked}`,
            notes: [unmarked],
        });
        expect(writes(calls)).toEqual([
            "linear:addLabel:DOT-110:external-review",
            "linear:removeLabel:DOT-110:code-review",
        ]);
    });

    it("a branch with no open pull request is not marked, and nothing is written", async () => {
        const calls: string[] = [];
        const given = linear(calls, ["personal", "AFK", "code-review"]);
        const { state, tools } = await reviewing("linear", "DOT-110", {}, { pullRequest: false });

        const report = await runTransition(REF, modeDeps(given, config(), state, tools), STARTED);

        expect(report.reasons).toEqual([`the branch ${BRANCH} has no open pull request`]);
        expect(writes(calls)).toEqual([]);
    });

    it("a leaving transition that is not into external-review reads no pull request", async () => {
        const prCalls: string[] = [];
        const given = linear([], ["personal", "AFK", "verify"]);
        const { state } = await guarded("linear", "DOT-110");

        const report = await runTransition(
            REF,
            modeDeps(given, config(), state, workTools({}, prCalls)),
            STARTED,
        );

        expect(report.applied).toBe(true);
        expect(prCalls.filter((call) => call.startsWith("pr "))).toEqual([]);
    });

    describe("Entering external-review needs no failed check", () => {
        it("Failed check: the report names main, the pull request stays a draft, nothing is written, exit 3", async () => {
            const calls: string[] = [];
            const prCalls: string[] = [];
            const given = linear(calls, ["personal", "AFK", "code-review"]);
            const { state } = await reviewing("linear", "DOT-110");
            const tools = workTools({ draft: true, checkRuns: failing }, prCalls);

            const report = await runTransition(
                REF,
                modeDeps(given, config(), state, tools),
                STARTED,
            );

            expect(report).toMatchObject({
                outcome: "not-evaluable",
                applied: false,
                reasons: ["the check main concluded failure on 0ddba11"],
            });
            expect(exitCodeFor(report.outcome)).toBe(3);
            expect(prCalls).not.toContain(`pr ready ${PULL_REQUEST}`);
            expect(writes(calls)).toEqual([]);
        });

        it("Check still running: main in progress and no check failed, the transition is applied", async () => {
            const given = linear([], ["personal", "AFK", "code-review"]);
            const running = [checkRun("main", { status: "in_progress", conclusion: null })];
            const { state, tools } = await reviewing(
                "linear",
                "DOT-110",
                {},
                { checkRuns: running },
            );

            const report = await runTransition(
                REF,
                modeDeps(given, config(), state, tools),
                STARTED,
            );

            expect(report).toMatchObject({ outcome: "advance", applied: true });
        });

        it("a review bot's failed check run is not a check of the pull request", async () => {
            const given = linear([], ["personal", "AFK", "code-review"]);
            const bot = [checkRun("CodeRabbit", { conclusion: "failure" })];
            const { state, tools } = await reviewing("linear", "DOT-110", {}, { checkRuns: bot });

            const report = await runTransition(
                REF,
                modeDeps(given, config(), state, tools),
                STARTED,
            );

            expect(report).toMatchObject({ outcome: "advance", applied: true });
        });
    });
});

describe("code-review-stage: The code review leaves the pull request a draft", () => {
    it("Before the transition: a code review whose transition only asks leaves its pull request a draft", async () => {
        const prCalls: string[] = [];
        const given = linear([], ["personal", "HITL", "code-review"]);
        const { state } = await reviewing("linear", "DOT-110");

        const report = await runTransition(
            REF,
            modeDeps(given, config(), state, workTools({ draft: true }, prCalls)),
            STARTED,
        );

        expect(report.handoff?.questions).toHaveLength(1);
        expect(prCalls).not.toContain(`pr ready ${PULL_REQUEST}`);
    });

    it("Code review complete: on the machine holding the workspace, the task carries external-review and its pull request is ready", async () => {
        const prCalls: string[] = [];
        const given = linear([], ["personal", "AFK", "code-review"]);
        const { state } = await reviewing("linear", "DOT-110");

        const report = await runTransition(
            REF,
            modeDeps(given, config(), state, workTools({ draft: true }, prCalls)),
            STARTED,
        );

        expect(report).toMatchObject({ outcome: "advance", applied: true, reasons: [] });
        expect(report.task?.labels).toEqual(["personal", "AFK", "external-review"]);
        expect(prCalls).toContain(`pr ready ${PULL_REQUEST}`);
    });
});
