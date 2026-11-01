import { describe, expect, it } from "vitest";

import { applyAnswers } from "../answer-mode.ts";
import type { Answer } from "../args.ts";
import type { AutonomousConfig, Source } from "../config.ts";
import { MEANINGS } from "../label-contract/contract.ts";
import { config, task, trackers } from "../label-triage/test-fixtures.ts";
import type { TrackerLabel, Trackers } from "../label-triage/trackers/tracker.ts";
import type { AnswerContext, AnswerRecord } from "../runner.ts";
import { transitionHandler } from "./answer.ts";
import {
    renderTransitionJson,
    renderTransitionText,
    runTransition,
    TRANSITION,
    TRANSITION_SCHEMA,
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

// Linear DOT-110 "Grill-me stage", whose labels are checked before any write.
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

function answer(id: string, ...values: string[]): Answer {
    return { id, values };
}

async function transition(given: Trackers, id: string, ...values: string[]): Promise<AnswerRecord> {
    const [record] = await transitionHandler.answer([answer(id, ...values)], context(given));
    if (record === undefined) {
        throw new Error(`no record for ${id}`);
    }
    return record;
}

async function labelsOf(given: Trackers, source: Source, id: string): Promise<string[]> {
    const read = await given[source].readTask(id);
    return read.ok ? read.value.labels : [];
}

// The fake removes every label; this one fails on `label` and does the rest as before.
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
    const report = await runTransition({ source, id }, context(given), STARTED);
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
            context(given),
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
            context(given),
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
            context(given, disabled("linear")),
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
            context(given),
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
            context(given),
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
            context(given),
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
            context(given),
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
            context(given),
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

        const records = await transitionHandler.answer(
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

        const records = await transitionHandler.answer(
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

        const [record] = await transitionHandler.answer(
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
            [transitionHandler],
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
