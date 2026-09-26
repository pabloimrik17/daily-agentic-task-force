import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type { Exec, ExecResult } from "../exec.ts";
import {
    buildPrompt,
    claudeJudgement,
    interpretAnswers,
    type JudgementAnswer,
    type JudgementRequest,
    JUDGEMENT_SCHEMA,
    JUDGEMENT_TIMEOUT_MS,
} from "./judgement.ts";

function fakeExec(
    handler: (args: string[], input: string | undefined) => ExecResult,
): Exec & { calls: { args: string[]; input: string | undefined }[] } {
    const calls: { args: string[]; input: string | undefined }[] = [];
    const exec = (args: string[], input?: string) => {
        calls.push({ args, input });
        return Promise.resolve(handler(args, input));
    };
    return Object.assign(exec, { calls });
}

const REQUEST: JudgementRequest = {
    model: "claude-sonnet-5",
    effort: "medium",
    tasks: [
        {
            id: "DOT-82",
            source: "linear",
            title: "Add the label contract",
            description: "Define the labels every task carries.",
            labels: ["feature"],
            groups: ["scope", "entry"],
        },
        {
            id: "agentic-task-kc2.29",
            source: "beads",
            title: "SECURITY: fix the thing",
            description: null,
            labels: ["work"],
            groups: ["entry"],
        },
    ],
};

const ANSWERS: JudgementAnswer[] = [
    {
        id: "DOT-82",
        scope: { labels: ["personal"], confidence: 0.9, reason: "It is a personal plugin." },
        entry: { labels: ["AFK"], confidence: 0.97, reason: "The spec is complete." },
    },
    {
        id: "agentic-task-kc2.29",
        entry: { labels: ["HITL"], confidence: 0.8, reason: "Security work needs review." },
    },
];

function envelopeFor(structured: unknown): Record<string, unknown> {
    return {
        type: "result",
        subtype: "success",
        is_error: false,
        num_turns: 2,
        result: JSON.stringify(structured),
        structured_output: structured,
        session_id: "abc",
        total_cost_usd: 0.0586,
    };
}

function succeeding(
    envelope: unknown,
): Exec & { calls: { args: string[]; input: string | undefined }[] } {
    return fakeExec(() => ({ ok: true, stdout: JSON.stringify(envelope) }));
}

describe("buildPrompt", () => {
    it("embeds criteria.md verbatim", () => {
        const criteria = readFileSync(new URL("./criteria.md", import.meta.url), "utf8");

        expect(buildPrompt(REQUEST.tasks)).toContain(criteria);
    });

    it("embeds the batch as JSON", () => {
        expect(buildPrompt(REQUEST.tasks)).toContain(JSON.stringify(REQUEST.tasks, null, 2));
    });
});

describe("JUDGEMENT_SCHEMA", () => {
    it("requires the tasks and rejects any other field", () => {
        expect(JUDGEMENT_SCHEMA).toMatchObject({
            type: "object",
            required: ["tasks"],
            additionalProperties: false,
            properties: {
                tasks: {
                    type: "array",
                    items: {
                        required: ["id"],
                        additionalProperties: false,
                        properties: {
                            scope: {
                                required: ["labels", "confidence", "reason"],
                                additionalProperties: false,
                            },
                            entry: {
                                required: ["labels", "confidence", "reason"],
                                additionalProperties: false,
                            },
                        },
                    },
                },
            },
        });
    });
});

describe("claudeJudgement", () => {
    it("allows 300 s per batch", () => {
        expect(JUDGEMENT_TIMEOUT_MS).toBe(300_000);
    });

    it("calls claude in print mode with the schema and passes the prompt on stdin", async () => {
        const exec = succeeding(envelopeFor({ tasks: ANSWERS }));
        await claudeJudgement(exec)(REQUEST);

        expect(exec.calls).toEqual([
            {
                args: [
                    "-p",
                    "--model",
                    "claude-sonnet-5",
                    "--effort",
                    "medium",
                    "--output-format",
                    "json",
                    "--json-schema",
                    JSON.stringify(JUDGEMENT_SCHEMA),
                ],
                input: buildPrompt(REQUEST.tasks),
            },
        ]);
    });

    it("returns the answers of a valid batch", async () => {
        const exec = succeeding(envelopeFor({ tasks: ANSWERS }));
        const result = await claudeJudgement(exec)(REQUEST);

        expect(result).toEqual({ ok: true, answers: ANSWERS });
    });

    it("passes a failed call through unchanged", async () => {
        const exec = fakeExec(() => ({ ok: false, error: "claude timed out after 300 s" }));
        const result = await claudeJudgement(exec)(REQUEST);

        expect(result).toEqual({ ok: false, error: "claude timed out after 300 s" });
    });

    it("reports output that is not valid JSON", async () => {
        const exec = fakeExec(() => ({ ok: true, stdout: "not json" }));
        const result = await claudeJudgement(exec)(REQUEST);

        expect(result.ok).toBe(false);
        expect(!result.ok && result.error).toMatch(/^claude output is not valid JSON: /);
    });

    it("reports an envelope that is not a result", async () => {
        const exec = succeeding({ ...envelopeFor({ tasks: [] }), type: "system" });
        const result = await claudeJudgement(exec)(REQUEST);

        expect(result).toEqual({
            ok: false,
            error: 'claude envelope: $.type is "system", expected "result"',
        });
    });

    it("reports an envelope whose subtype is not success", async () => {
        const exec = succeeding({ ...envelopeFor({ tasks: [] }), subtype: "error_max_turns" });
        const result = await claudeJudgement(exec)(REQUEST);

        expect(result).toEqual({
            ok: false,
            error: 'claude envelope: $.subtype is "error_max_turns", expected "success"',
        });
    });

    it("reports an envelope flagged as an error", async () => {
        const exec = succeeding({ ...envelopeFor({ tasks: [] }), is_error: true });
        const result = await claudeJudgement(exec)(REQUEST);

        expect(result).toEqual({
            ok: false,
            error: "claude envelope: $.is_error is true, expected false",
        });
    });

    it("reports an envelope without structured output", async () => {
        const { structured_output: _omitted, ...withoutOutput } = envelopeFor({ tasks: [] });
        const exec = succeeding(withoutOutput);
        const result = await claudeJudgement(exec)(REQUEST);

        expect(result).toEqual({
            ok: false,
            error: "claude envelope: $.structured_output must be an object",
        });
    });

    it("reports an envelope that is not an object", async () => {
        const exec = succeeding([]);
        const result = await claudeJudgement(exec)(REQUEST);

        expect(result).toEqual({ ok: false, error: "claude envelope: $ must be an object" });
    });

    it("reports a payload field of the wrong type with its path", async () => {
        const exec = succeeding(envelopeFor({ tasks: [{ id: 7 }] }));
        const result = await claudeJudgement(exec)(REQUEST);

        expect(result).toEqual({
            ok: false,
            error: "claude judgement does not match the schema: $.tasks[0].id must be a string",
        });
    });

    it("reports a group answer missing a field with its path", async () => {
        const exec = succeeding(
            envelopeFor({ tasks: [{ id: "DOT-82", entry: { labels: ["AFK"], reason: "r" } }] }),
        );
        const result = await claudeJudgement(exec)(REQUEST);

        expect(result).toEqual({
            ok: false,
            error: "claude judgement does not match the schema: $.tasks[0].entry.confidence must be a finite number",
        });
    });

    it("rejects an unknown payload field", async () => {
        const exec = succeeding(envelopeFor({ tasks: [{ id: "DOT-82", priority: "high" }] }));
        const result = await claudeJudgement(exec)(REQUEST);

        expect(result).toEqual({
            ok: false,
            error: "claude judgement does not match the schema: $.tasks[0].priority is not a recognised field",
        });
    });
});

describe("interpretAnswers", () => {
    it("derives one label set per requested group of a valid batch", () => {
        const result = interpretAnswers(REQUEST, ANSWERS);

        expect(result).toEqual({
            judged: [
                {
                    source: "linear",
                    taskId: "DOT-82",
                    title: "Add the label contract",
                    group: "scope",
                    labels: ["personal"],
                    confidence: 0.9,
                    reason: "It is a personal plugin.",
                    tier: "llm",
                },
                {
                    source: "linear",
                    taskId: "DOT-82",
                    title: "Add the label contract",
                    group: "entry",
                    labels: ["AFK"],
                    confidence: 0.97,
                    reason: "The spec is complete.",
                    tier: "llm",
                },
                {
                    source: "beads",
                    taskId: "agentic-task-kc2.29",
                    title: "SECURITY: fix the thing",
                    group: "entry",
                    labels: ["HITL"],
                    confidence: 0.8,
                    reason: "Security work needs review.",
                    tier: "llm",
                },
            ],
            notJudged: [],
        });
    });

    it("reports a task missing from the answer as not judged", () => {
        const result = interpretAnswers(REQUEST, [ANSWERS[0]!]);

        expect(result.judged.map((item) => item.taskId)).toEqual(["DOT-82", "DOT-82"]);
        expect(result.notJudged).toEqual([
            { id: "agentic-task-kc2.29", source: "beads", reason: "missing from the judgement" },
        ]);
    });

    it("reports a task whose requested group is unanswered as not judged", () => {
        const result = interpretAnswers(REQUEST, [
            { id: "DOT-82", entry: ANSWERS[0]!.entry! },
            ANSWERS[1]!,
        ]);

        expect(result.judged.map((item) => item.taskId)).toEqual(["agentic-task-kc2.29"]);
        expect(result.notJudged).toEqual([
            { id: "DOT-82", source: "linear", reason: "no scope answer" },
        ]);
    });

    it("discards the whole task when one of its labels is outside the vocabulary", () => {
        const result = interpretAnswers(REQUEST, [
            {
                ...ANSWERS[0]!,
                entry: { labels: ["AFK", "urgent"], confidence: 0.9, reason: "r" },
            },
            ANSWERS[1]!,
        ]);

        expect(result.judged.map((item) => item.taskId)).toEqual(["agentic-task-kc2.29"]);
        expect(result.notJudged).toEqual([
            {
                id: "DOT-82",
                source: "linear",
                reason: 'label "urgent" is outside the entry vocabulary',
            },
        ]);
    });

    it("rejects a label from the other group", () => {
        const result = interpretAnswers(REQUEST, [
            ANSWERS[0]!,
            {
                id: "agentic-task-kc2.29",
                entry: { labels: ["work"], confidence: 0.9, reason: "r" },
            },
        ]);

        expect(result.notJudged).toEqual([
            {
                id: "agentic-task-kc2.29",
                source: "beads",
                reason: 'label "work" is outside the entry vocabulary',
            },
        ]);
    });

    it("reports a confidence above 1 as not judged", () => {
        const result = interpretAnswers(REQUEST, [
            ANSWERS[0]!,
            {
                id: "agentic-task-kc2.29",
                entry: { labels: ["HITL"], confidence: 1.2, reason: "r" },
            },
        ]);

        expect(result.judged.map((item) => item.taskId)).toEqual(["DOT-82", "DOT-82"]);
        expect(result.notJudged).toEqual([
            {
                id: "agentic-task-kc2.29",
                source: "beads",
                reason: "entry confidence 1.2 is outside [0, 1]",
            },
        ]);
    });

    it("reports a task answered twice as not judged", () => {
        const result = interpretAnswers(REQUEST, [...ANSWERS, ANSWERS[1]!]);

        expect(result.judged.map((item) => item.taskId)).toEqual(["DOT-82", "DOT-82"]);
        expect(result.notJudged).toEqual([
            { id: "agentic-task-kc2.29", source: "beads", reason: "duplicate answer" },
        ]);
    });

    it("ignores groups and tasks that were not requested", () => {
        const result = interpretAnswers(REQUEST, [
            ...ANSWERS.slice(0, 1),
            {
                ...ANSWERS[1]!,
                scope: { labels: ["personal"], confidence: 0.99, reason: "unrequested" },
            },
            { id: "UNKNOWN-1", scope: { labels: ["work"], confidence: 1, reason: "r" } },
        ]);

        expect(result.judged).toHaveLength(3);
        expect(result.judged.filter((item) => item.taskId === "agentic-task-kc2.29")).toEqual([
            expect.objectContaining({ group: "entry" }),
        ]);
        expect(result.notJudged).toEqual([]);
    });
});
