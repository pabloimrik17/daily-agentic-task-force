import { describe, expect, it } from "vitest";

import { type AnswerHandler, answeringSteps, applyAnswers } from "./answer-mode.ts";
import type { Answer } from "./args.ts";
import { config, trackers } from "./label-triage/test-fixtures.ts";
import type { AnswerContext, AnswerRecord, AnswerStatus, Step } from "./runner.ts";

const STARTED = new Date("2026-10-17T09:00:00Z");
const CTX: AnswerContext = { config: config(), trackers: trackers([], {}) };

const answer = (id: string, ...values: string[]): Answer => ({ id, values });

const recordOf = (given: Answer, status: AnswerStatus): AnswerRecord => ({
    id: given.id,
    labels: given.values,
    status,
    detail: `${status} by the fake`,
});

// A handler that records each call and answers every answer with `status`,
// in the reverse of the order it received them.
function handler(id: string, status: AnswerStatus = "applied") {
    const calls: Answer[][] = [];
    const made: AnswerHandler = {
        id,
        answer: (answers) => {
            calls.push([...answers]);
            return Promise.resolve(answers.map((given) => recordOf(given, status)).reverse());
        },
    };
    return { made, calls };
}

describe("applyAnswers routing", () => {
    it("gives a handler all its answers in one call, in input order, and returns the records in the answers' order", async () => {
        const triage = handler("label-triage");
        const transition = handler("transition");
        const answers = [
            answer("label-triage:beads:B-1:autonomy", "HITL"),
            answer("transition:linear:DOT-110", "AFK"),
            answer("label-triage:beads:B-2:scope", "personal"),
        ];

        const report = await applyAnswers([triage.made, transition.made], answers, CTX, STARTED);

        expect(triage.calls).toEqual([[answers[0], answers[2]]]);
        expect(transition.calls).toEqual([[answers[1]]]);
        expect(report).toEqual({
            schema: "autonomous.answers.v1",
            startedAt: "2026-10-17T09:00:00.000Z",
            outcome: "advance",
            answers: answers.map((given) => recordOf(given, "applied")),
        });
    });

    it("reaches the handler with id transition for an answer id that names the transition", async () => {
        const transition = handler("transition");
        const triage = handler("label-triage");
        const given = answer("transition:linear:DOT-110", "AFK");

        const report = await applyAnswers([triage.made, transition.made], [given], CTX, STARTED);

        expect(transition.calls).toEqual([[given]]);
        expect(triage.calls).toEqual([]);
        expect(report.answers).toEqual([recordOf(given, "applied")]);
    });

    it("hands the handler the context it was given", async () => {
        const seen: AnswerContext[] = [];
        const spy: AnswerHandler = {
            id: "transition",
            answer: (answers, ctx) => {
                seen.push(ctx);
                return Promise.resolve(answers.map((given) => recordOf(given, "applied")));
            },
        };

        await applyAnswers([spy], [answer("transition:beads:B-1", "HITL")], CTX, STARTED);

        expect(seen).toEqual([CTX]);
        expect(seen[0]).toBe(CTX);
    });

    it("rejects an answer whose prefix names no handler and still processes the others", async () => {
        const triage = handler("label-triage");
        const stray = answer("nope:beads:B-1", "HITL", "grill-me");
        const known = answer("label-triage:beads:B-1:autonomy", "HITL");

        const report = await applyAnswers([triage.made], [stray, known], CTX, STARTED);

        expect(triage.calls).toEqual([[known]]);
        expect(report.outcome).toBe("not-evaluable");
        expect(report.answers).toEqual([
            {
                id: "nope:beads:B-1",
                labels: ["HITL", "grill-me"],
                status: "rejected",
                detail: "no step nope takes answers",
            },
            recordOf(known, "applied"),
        ]);
    });

    it("takes the whole id as the prefix when it holds no colon", async () => {
        const report = await applyAnswers([], [answer("loose", "HITL")], CTX, STARTED);

        expect(report.answers).toEqual([
            {
                id: "loose",
                labels: ["HITL"],
                status: "rejected",
                detail: "no step loose takes answers",
            },
        ]);
    });

    it.each<[AnswerStatus, "advance" | "not-evaluable"]>([
        ["applied", "advance"],
        ["skipped", "advance"],
        ["rejected", "not-evaluable"],
        ["failed", "not-evaluable"],
    ])("reports %s as %s", async (status, outcome) => {
        const report = await applyAnswers(
            [handler("transition", status).made],
            [answer("transition:beads:B-1", "HITL")],
            CTX,
            STARTED,
        );

        expect(report.outcome).toBe(outcome);
    });

    it("throws when a handler returns no record for an answer", async () => {
        const silent: AnswerHandler = { id: "label-triage", answer: () => Promise.resolve([]) };

        await expect(
            applyAnswers([silent], [answer("label-triage:1", "HITL")], CTX, STARTED),
        ).rejects.toThrow("no record for answer label-triage:1");
    });
});

describe("answeringSteps", () => {
    const step = (id: string, answers?: Step["answer"]): Step => ({
        id,
        run: () => Promise.reject(new Error(`${id} ran`)),
        render: () => "",
        ...(answers === undefined ? {} : { answer: answers }),
    });

    it("keeps only the steps that take answers, in step order", () => {
        const takes = () => Promise.resolve([]);
        const handlers = answeringSteps([
            step("reconcile"),
            step("label-triage", takes),
            step("select"),
            step("launch", takes),
        ]);

        expect(handlers.map((handled) => handled.id)).toEqual(["label-triage", "launch"]);
    });

    it("yields handlers that route like any other", async () => {
        const [handled] = answeringSteps([
            step("label-triage", (answers) =>
                Promise.resolve(answers.map((given) => recordOf(given, "applied"))),
            ),
        ]);
        const given = answer("label-triage:beads:B-1:autonomy", "HITL");

        const report = await applyAnswers(
            handled === undefined ? [] : [handled],
            [given],
            CTX,
            STARTED,
        );

        expect(report.answers).toEqual([recordOf(given, "applied")]);
    });
});
