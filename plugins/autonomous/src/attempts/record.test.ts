import { describe, expect, it } from "vitest";

import {
    ATTEMPT_SCHEMA,
    ATTEMPT_STATES,
    type AttemptRecord,
    attemptId,
    holdsTask,
    isSource,
    OPEN_STATES,
    parseAttemptId,
    parseTaskRef,
} from "./record.ts";

const RECORD: AttemptRecord = {
    schema: ATTEMPT_SCHEMA,
    id: "linear:DOT-109:test:1",
    task: { source: "linear", id: "DOT-109", title: "Stage session manager" },
    stage: "test",
    attempt: 1,
    state: "pending",
    history: [{ state: "pending", at: "2026-10-17T12:00:00.000Z" }],
    taken: { added: null, removed: null },
    workspace: {
        manager: "worktrunk",
        repository: "/w/dotfiles",
        inferredFrom: "project Dotfiles",
        branch: "feature/DOT-109-stage-session-manager",
        path: "/w/dotfiles-worktrees/feature-DOT-109-stage-session-manager",
    },
    session: null,
    observed: null,
    cleanup: null,
    retained: null,
};

it("identifies a record by its task, stage and number", () => {
    expect(RECORD.schema).toBe("autonomous.attempt.v1");
    expect(attemptId(RECORD.task, RECORD.stage, RECORD.attempt)).toBe(RECORD.id);
    expect(ATTEMPT_STATES).toContain(RECORD.state);
    expect(ATTEMPT_STATES).toHaveLength(7);
});

describe("attemptId", () => {
    it("joins source, task, stage and number with colons", () => {
        expect(attemptId({ source: "linear", id: "DOT-109" }, "grill-me", 2)).toBe(
            "linear:DOT-109:grill-me:2",
        );
        expect(attemptId({ source: "github", id: "owner/name#12" }, "test", 1)).toBe(
            "github:owner/name#12:test:1",
        );
    });
});

describe("parseTaskRef", () => {
    it("splits at the first colon", () => {
        expect(parseTaskRef("beads:agentic-task-2x0")).toEqual({
            source: "beads",
            id: "agentic-task-2x0",
        });
        expect(parseTaskRef("github:owner/name#12")).toEqual({
            source: "github",
            id: "owner/name#12",
        });
    });

    it.each(["DOT-109", "jira:DOT-109", "linear:", ":DOT-109"])("rejects %s", (value) => {
        expect(parseTaskRef(value)).toBeNull();
    });
});

describe("parseAttemptId", () => {
    it("reads the four parts", () => {
        expect(parseAttemptId("linear:DOT-109:test:3")).toEqual({
            task: { source: "linear", id: "DOT-109" },
            stage: "test",
            attempt: 3,
        });
    });

    it.each([
        "linear:DOT-109",
        "linear:DOT-109:test",
        "jira:DOT-109:test:1",
        "linear::test:1",
        "linear:DOT-109::1",
        "linear:DOT-109:test:0",
        "linear:DOT-109:test:x",
        "linear:DOT-109:test:1:extra",
    ])("rejects %s", (value) => {
        expect(parseAttemptId(value)).toBeNull();
    });
});

describe("isSource", () => {
    it("accepts the three sources only", () => {
        expect(["linear", "beads", "github", "jira", ""].map(isSource)).toEqual([
            true,
            true,
            true,
            false,
            false,
        ]);
    });
});

it("holds the task while pending, created, started or retained", () => {
    expect(OPEN_STATES).toEqual(["pending", "created", "started", "retained"]);
});

it("holds the task while open, or completed with a cleanup still owed", () => {
    const cleanup = { pending: true as const, error: "aoe remove failed" };
    const held = ATTEMPT_STATES.map((state) => [
        state,
        holdsTask({ ...RECORD, state, cleanup: null }),
        holdsTask({ ...RECORD, state, cleanup }),
    ]);
    expect(held).toEqual([
        ["pending", true, true],
        ["created", true, true],
        ["started", true, true],
        ["completed", false, true],
        ["retained", true, true],
        ["aborted", false, false],
        ["discarded", false, false],
    ]);
});
