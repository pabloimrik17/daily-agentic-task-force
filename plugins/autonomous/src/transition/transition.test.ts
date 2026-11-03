import { rmSync, writeFileSync } from "node:fs";
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
    writeJsonAtomic,
    writeRecord,
} from "../attempts/state.ts";
import { record as startedAttempt, tempState } from "../attempts/test-fixtures.ts";
import type { AutonomousConfig, Source } from "../config.ts";
import { MEANINGS } from "../label-contract/contract.ts";
import { config, task, trackers } from "../label-triage/test-fixtures.ts";
import type { TrackerLabel, Trackers } from "../label-triage/trackers/tracker.ts";
import { exitCodeFor } from "../report.ts";
import type { AnswerContext, AnswerRecord } from "../runner.ts";
import { transitionHandler } from "./answer.ts";
import {
    renderTransitionJson,
    renderTransitionText,
    runTransition,
    TRANSITION,
    TRANSITION_SCHEMA,
    type TransitionDeps,
    transitionQuestionId,
    unconfiguredTransition,
} from "./mode.ts";

const STARTED = new Date("2026-11-01T09:00:00.000Z");

const CONTRACT = ["work", "personal", "AFK", "HITL", "grill-me", "proposal", "taken"];

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
): TransitionDeps {
    return { config: configured, trackers: given, state };
}

function answer(id: string, ...values: string[]): Answer {
    return { id, values };
}

async function transition(given: Trackers, id: string, ...values: string[]): Promise<AnswerRecord> {
    const [record] = await transitionHandler(NO_STATE).answer(
        [answer(id, ...values)],
        context(given),
    );
    if (record === undefined) {
        throw new Error(`no record for ${id}`);
    }
    return record;
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

const writes = (calls: readonly string[]) =>
    calls.filter((call) => call.includes(":addLabel:") || call.includes(":removeLabel:"));

const removals = (calls: readonly string[]) =>
    calls.filter((call) => call.includes(":removeLabel:"));

async function questionFor(source: Source, id: string, labels: string[]) {
    const given = trackers([], { [source]: [task(source, id, labels)] });
    const report = await runTransition({ source, id }, modeDeps(given), STARTED);
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

    it("Task not in grill-me: the reason says so and there is no handoff", async () => {
        const calls: string[] = [];
        const given = linear(calls, ["personal", "AFK", "proposal"]);

        const report = await runTransition(
            { source: "linear", id: "DOT-110" },
            modeDeps(given),
            STARTED,
        );

        expect(report.outcome).toBe("not-evaluable");
        expect(report.task).toEqual({
            source: "linear",
            id: "DOT-110",
            title: "Grill-me stage",
            labels: ["personal", "AFK", "proposal"],
        });
        expect(report.reasons).toEqual([
            "linear DOT-110 is not in grill-me (labels [personal, AFK, proposal])",
        ]);
        expect(report).not.toHaveProperty("handoff");
        expect(calls).toEqual(["linear:readTask:DOT-110"]);
    });

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
        expect(TRANSITION_SCHEMA).toBe("autonomous.transition.v1");
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

    it("the text of a task not in grill-me lists the reason and no handoff", async () => {
        const given = linear([], ["personal", "AFK", "proposal"]);
        const report = await runTransition(
            { source: "linear", id: "DOT-110" },
            modeDeps(given),
            STARTED,
        );

        expect(renderTransitionText(report)).toBe(
            [
                "autonomous transition — started 2026-11-01T09:00:00.000Z",
                "outcome: not-evaluable",
                'task: linear DOT-110 → "Grill-me stage" → labels [personal, AFK, proposal]',
                "reasons:",
                "  - linear DOT-110 is not in grill-me (labels [personal, AFK, proposal])",
            ].join("\n"),
        );
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

        const records = await transitionHandler(NO_STATE).answer(
            [
                answer("transition:linear:DOT-110", "grill-me"),
                answer("transition:linear:DOT-111", "AFK", "HITL"),
                answer("transition:linear:DOT-112"),
            ],
            context(given),
        );

        const detail = "invalid for the transition: expected one of AFK, HITL";
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

    it("a malformed id is rejected, naming the problem", async () => {
        const calls: string[] = [];
        const given = linear(calls, ["work", "grill-me"]);

        const records = await transitionHandler(NO_STATE).answer(
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

        const [record] = await transitionHandler(NO_STATE).answer(
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
            [transitionHandler(NO_STATE)],
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
        const given = linear(calls, ["work", "grill-me"], { dropsOnAdd: "grill-me" });

        const record = await transition(given, "transition:linear:DOT-110", "AFK");

        expect(record).toMatchObject({
            status: "failed",
            detail: "read-back mismatch: before [work, grill-me] + [AFK, proposal] → after [work, AFK, proposal]; nothing was removed",
        });
        expect(removals(calls)).toEqual([]);
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
        const [only] = await transitionHandler(state).answer(
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

    it("a task outside grill-me is reported as such, whatever its attempts hold", async () => {
        const state = await stateWith({});

        const result = await report(linear([], ["personal", "AFK", "proposal"]), state);
        const skipped = await answered(linear([], ["work", "AFK", "proposal"]), state);

        expect(result.reasons).toEqual([
            "linear DOT-110 is not in grill-me (labels [personal, AFK, proposal])",
        ]);
        expect(skipped.status).toBe("skipped");
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
            [transitionHandler(state)],
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
