import { describe, expect, it } from "vitest";
import { ATTEMPT_SCHEMA, type AttemptRecord } from "../attempts/record.ts";
import { workTask } from "../select/test-fixtures.ts";
import { expectedMarker } from "./prompt.ts";
import { STAGES, stageFor } from "./registry.ts";
import type { StagePromptInput } from "./stage.ts";
import { testStage } from "./test.ts";

const ID = "linear:DOT-109:test:1";
const RESULT_PATH = "/state/attempts/linear/DOT-109/test/1/result.json";

function attempt(): AttemptRecord {
    return {
        schema: ATTEMPT_SCHEMA,
        id: ID,
        task: { source: "linear", id: "DOT-109", title: "Stage sessions" },
        stage: "test",
        attempt: 1,
        state: "started",
        history: [{ state: "started", at: "2026-10-17T10:00:00Z" }],
        taken: { added: "2026-10-17T10:00:00Z", removed: null },
        workspace: {
            manager: "worktrunk",
            repository: "/home/me/WebstormProjects/repo",
            inferredFrom: "project",
            branch: "feature/DOT-109-stage-sessions",
            path: "/home/me/WebstormProjects/repo-worktrees/feature-DOT-109-stage-sessions",
        },
        session: null,
        observed: null,
        cleanup: null,
        retained: null,
    };
}

function input(description: string | null = "Do the thing."): StagePromptInput {
    return {
        attempt: attempt(),
        task: { ...workTask("linear", "DOT-109"), description },
        resultPath: RESULT_PATH,
    };
}

describe("the stage registry", () => {
    it("holds the test stage only", () => {
        expect([...STAGES.keys()]).toEqual(["test"]);
        expect(stageFor("test")).toBe(testStage);
    });

    it("has no grill-me yet", () => {
        expect(stageFor("grill-me")).toBeUndefined();
    });
});

describe("expectedMarker", () => {
    it("parses as a marker for the attempt", () => {
        expect(JSON.parse(expectedMarker(ID))).toMatchObject({
            schema: "autonomous.result.v1",
            attempt: ID,
            outcome: "completed",
        });
    });
});

describe("the test stage", () => {
    it("has its id and emoji", () => {
        expect(testStage.id).toBe("test");
        expect(testStage.emoji).toBe("🧪");
    });

    it("names the marker path, the attempt id and the expected marker in its prompt", () => {
        const prompt = testStage.prompt(input());
        expect(prompt).toContain(RESULT_PATH);
        expect(prompt).toContain(ID);
        expect(prompt).toContain(expectedMarker(ID));
    });

    it("carries the task and its description verbatim", () => {
        const prompt = testStage.prompt(input("Line one.\n\nLine two."));
        expect(prompt).toContain("linear");
        expect(prompt).toContain("DOT-109");
        expect(prompt).toContain("Line one.\n\nLine two.");
    });

    it("says so when the task has no description", () => {
        expect(testStage.prompt(input(null))).toContain("(no description)");
    });

    it("asks only for the marker and no change to the repository", () => {
        const prompt = testStage.prompt(input());
        expect(prompt).toContain("Do not change any file of the repository");
        expect(prompt).toContain("then stop");
    });

    it("always completes", () => {
        expect(testStage.completed(workTask())).toBe(true);
    });

    it("passes the model and effort for claude and the effort alone for codex", () => {
        expect(testStage.agentArgs("claude")).toEqual(["--model", "haiku", "--effort", "low"]);
        expect(testStage.agentArgs("codex")).toEqual(["-c", "model_reasoning_effort=low"]);
    });
});
