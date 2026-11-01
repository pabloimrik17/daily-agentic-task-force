import { describe, expect, it } from "vitest";

import { parseQuestionId, questionId } from "./question-id.ts";

describe("question ids", () => {
    it.each([
        ["label-triage:beads:agentic-task-8v0:autonomy", "beads", "agentic-task-8v0", "autonomy"],
        ["label-triage:linear:DOT-104:scope", "linear", "DOT-104", "scope"],
        ["label-triage:github:owner/name#12:autonomy", "github", "owner/name#12", "autonomy"],
    ] as const)("round-trips %s", (id, source, taskId, group) => {
        const parsed = parseQuestionId(id);
        expect(parsed).toEqual({ ok: true, target: { source, taskId, group } });
        expect(questionId({ source, taskId, group })).toBe(id);
    });

    it.each([
        ["label-triage", "unknown question label-triage"],
        ["label-triage:beads", "unknown question label-triage:beads"],
        ["label-triage:beads:autonomy", "unknown question label-triage:beads:autonomy"],
        ["label-triage:beads::autonomy", "unknown question label-triage:beads::autonomy"],
        ["quota-gate:beads:X-1:autonomy", "unknown question quota-gate:beads:X-1:autonomy"],
        ["label-triage:jira:X-1:autonomy", "unknown source jira"],
        ["label-triage:beads:X-1:stage", "unknown group stage"],
        ["label-triage:beads:X-1:entry", "unknown group entry"],
        ["label-triage:beads:X-1:toString", "unknown group toString"],
    ])("rejects %s", (id, error) => {
        expect(parseQuestionId(id)).toEqual({ ok: false, error });
    });
});
