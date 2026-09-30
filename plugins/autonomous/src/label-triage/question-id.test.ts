import { describe, expect, it } from "vitest";

import { parseQuestionId, questionId } from "./question-id.ts";

describe("question ids", () => {
    it.each([
        ["label-triage:beads:agentic-task-8v0:entry", "beads", "agentic-task-8v0", "entry"],
        ["label-triage:linear:DOT-104:scope", "linear", "DOT-104", "scope"],
        ["label-triage:github:owner/name#12:entry", "github", "owner/name#12", "entry"],
    ] as const)("round-trips %s", (id, source, taskId, group) => {
        const parsed = parseQuestionId(id);
        expect(parsed).toEqual({ ok: true, target: { source, taskId, group } });
        expect(questionId({ source, taskId, group })).toBe(id);
    });

    it.each([
        ["label-triage", "unknown question label-triage"],
        ["label-triage:beads", "unknown question label-triage:beads"],
        ["label-triage:beads:entry", "unknown question label-triage:beads:entry"],
        ["label-triage:beads::entry", "unknown question label-triage:beads::entry"],
        ["quota-gate:beads:X-1:entry", "unknown question quota-gate:beads:X-1:entry"],
        ["label-triage:jira:X-1:entry", "unknown source jira"],
        ["label-triage:beads:X-1:stage", "unknown group stage"],
        ["label-triage:beads:X-1:toString", "unknown group toString"],
    ])("rejects %s", (id, error) => {
        expect(parseQuestionId(id)).toEqual({ ok: false, error });
    });
});
