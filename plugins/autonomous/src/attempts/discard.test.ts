import { rmSync } from "node:fs";
import { writeFile } from "node:fs/promises";

import { afterEach, describe, expect, it } from "vitest";

import type { RunArgs } from "../args.ts";
import { task, trackers } from "../label-triage/test-fixtures.ts";
import type { Observed, SessionManager } from "../sessions/manager.ts";
import type { WorkspaceManager } from "../workspace/manager.ts";
import {
    DISCARD_SCHEMA,
    discardAttempt,
    renderDiscardJson,
    renderDiscardText,
    unconfiguredDiscard,
} from "./discard.ts";
import type { AttemptRecord } from "./record.ts";
import { attemptDir, readRecord, recordPath, writeRecord } from "./state.ts";
import { fakeSessions, fakeWorkspace, record, tempState } from "./test-fixtures.ts";

const STARTED = new Date("2026-10-17T13:00:00.000Z");
const LATER = new Date("2026-10-17T13:00:07.000Z");
const OPEN: Observed = {
    state: "open",
    status: "Idle",
    busy: false,
    needsHuman: false,
    agentSessionId: null,
};

const states: string[] = [];

afterEach(() => {
    for (const state of states.splice(0)) {
        rmSync(state, { recursive: true, force: true });
    }
});

function args(discard: string, releaseWorkspace = false): RunArgs {
    return {
        account: undefined,
        task: undefined,
        stage: undefined,
        discard,
        releaseWorkspace,
        force: false,
        json: false,
        apply: true,
        bootstrapLabels: false,
        noHandoff: false,
        answers: [],
    };
}

interface Setup {
    records?: AttemptRecord[];
    sessions?: Partial<SessionManager>;
    workspace?: Partial<WorkspaceManager>;
    labels?: string[]; // the labels the task carries in the tracker
}

// Everything shares one `calls` log, so a test can assert the order of the whole discard.
async function setup(options: Setup = {}) {
    const state = tempState();
    states.push(state);
    for (const attempt of options.records ?? [record()]) {
        await writeRecord(state, attempt);
    }
    const calls: string[] = [];
    const sessions = fakeSessions({
        calls,
        observe: () => Promise.resolve({ ok: true, value: OPEN }),
        remove: () => Promise.resolve({ ok: true, value: undefined }),
        ...options.sessions,
    });
    const workspace = fakeWorkspace({
        release: (repository, branch) => {
            calls.push(`released ${repository} ${branch}`);
            return Promise.resolve({ ok: true, value: undefined });
        },
        ...options.workspace,
    });
    const tasks = [task("linear", "DOT-109", options.labels ?? ["AFK", "taken"])];
    const deps = {
        state,
        sessions,
        workspace,
        trackers: trackers(calls, { linear: tasks }),
        now: () => LATER,
    };
    return { state, calls, deps, workspace };
}

const read = (state: string, id = "linear:DOT-109:test:1") =>
    readRecord(recordPath(attemptDir(state, id)));

describe("discardAttempt by attempt id", () => {
    it("removes the session and taken, and marks the attempt discarded", async () => {
        const { calls, deps } = await setup();

        const report = await discardAttempt(args("linear:DOT-109:test:1"), deps, STARTED);

        expect(report).toMatchObject({
            schema: "autonomous.discard.v1",
            startedAt: "2026-10-17T13:00:00.000Z",
            outcome: "advance",
            attempt: "linear:DOT-109:test:1",
            task: { source: "linear", id: "DOT-109" },
            found: [],
            removed: { session: true, taken: true, workspace: false },
        });
        expect(report.reasons).toEqual([
            "session ef3fde3ca69c4b8b removed",
            "taken removed from linear:DOT-109",
            "attempt linear:DOT-109:test:1 discarded",
        ]);
        expect(calls).toEqual([
            "observe ef3fde3ca69c4b8b",
            "remove ef3fde3ca69c4b8b",
            "linear:removeLabel:DOT-109:taken",
            "linear:readTask:DOT-109",
        ]);
        expect(deps.workspace.calls).toEqual([]);
    });

    it("keeps the record's directory and everything but the state, history and taken", async () => {
        const original = record({ state: "retained", retained: { at: "t", reason: "exited" } });
        const { state, deps } = await setup({ records: [original] });

        await discardAttempt(args("linear:DOT-109:test:1"), deps, STARTED);

        const after = await read(state);
        expect(after).toEqual({
            ...original,
            state: "discarded",
            history: [...original.history, { state: "discarded", at: LATER.toISOString() }],
            taken: { added: original.taken.added, removed: LATER.toISOString() },
        });
    });

    it("keeps the worktree: the workspace is not released without the flag", async () => {
        const { deps } = await setup();

        const report = await discardAttempt(args("linear:DOT-109:test:1"), deps, STARTED);

        expect(report.removed.workspace).toBe(false);
        expect(deps.workspace.calls).toEqual([]);
    });

    it("releases the workspace after the session with --release-workspace", async () => {
        const { calls, deps } = await setup();

        const report = await discardAttempt(args("linear:DOT-109:test:1", true), deps, STARTED);

        expect(report.outcome).toBe("advance");
        expect(report.removed).toEqual({ session: true, taken: true, workspace: true });
        expect(report.reasons.at(-1)).toBe(
            "worktree /w/dotfiles-worktrees/feature-DOT-109-stage-session-manager released",
        );
        expect(calls).toEqual([
            "observe ef3fde3ca69c4b8b",
            "remove ef3fde3ca69c4b8b",
            "linear:removeLabel:DOT-109:taken",
            "linear:readTask:DOT-109",
            "released /w/dotfiles feature/DOT-109-stage-session-manager",
        ]);
    });

    it("reports a release failure after the attempt was discarded", async () => {
        const { state, deps } = await setup({
            workspace: { release: () => Promise.resolve({ ok: false, error: "wt: dirty" }) },
        });

        const report = await discardAttempt(args("linear:DOT-109:test:1", true), deps, STARTED);

        expect(report.outcome).toBe("not-evaluable");
        expect(report.removed).toEqual({ session: true, taken: true, workspace: false });
        expect(report.reasons.at(-1)).toContain("wt: dirty");
        expect(report.reasons.at(-1)).toContain("the attempt is already discarded");
        expect((await read(state)).state).toBe("discarded");
    });

    it("stops when the session cannot be removed: no taken write, record unchanged", async () => {
        const original = record();
        const { state, calls, deps } = await setup({
            records: [original],
            sessions: { remove: () => Promise.resolve({ ok: false, error: "aoe: busy" }) },
        });

        const report = await discardAttempt(args("linear:DOT-109:test:1"), deps, STARTED);

        expect(report.outcome).toBe("not-evaluable");
        expect(report.removed).toEqual({ session: false, taken: false, workspace: false });
        expect(report.reasons).toEqual([
            "removing session ef3fde3ca69c4b8b failed: aoe: busy; nothing was changed",
        ]);
        expect(calls.some((call) => call.includes("removeLabel"))).toBe(false);
        expect(await read(state)).toEqual(original);
    });

    it("stops when the session cannot be observed", async () => {
        const original = record();
        const { state, calls, deps } = await setup({
            records: [original],
            sessions: { observe: () => Promise.resolve({ ok: false, error: "aoe: timeout" }) },
        });

        const report = await discardAttempt(args("linear:DOT-109:test:1"), deps, STARTED);

        expect(report.outcome).toBe("not-evaluable");
        expect(report.reasons).toEqual([
            "observing session ef3fde3ca69c4b8b failed: aoe: timeout; nothing was changed",
        ]);
        expect(calls).toEqual(["observe ef3fde3ca69c4b8b"]);
        expect(await read(state)).toEqual(original);
    });

    it("skips the removal of a session that is already gone and still discards", async () => {
        const { state, calls, deps } = await setup({
            sessions: {
                observe: () => Promise.resolve({ ok: true, value: { ...OPEN, state: "gone" } }),
            },
        });

        const report = await discardAttempt(args("linear:DOT-109:test:1"), deps, STARTED);

        expect(report.outcome).toBe("advance");
        expect(report.removed).toEqual({ session: false, taken: true, workspace: false });
        expect(report.reasons[0]).toBe("session ef3fde3ca69c4b8b was already gone");
        expect(calls).not.toContain("remove ef3fde3ca69c4b8b");
        expect((await read(state)).state).toBe("discarded");
    });

    it("discards an attempt that has no session without touching the manager", async () => {
        const { state, calls, deps } = await setup({ records: [record({ session: null })] });

        const report = await discardAttempt(args("linear:DOT-109:test:1"), deps, STARTED);

        expect(report.outcome).toBe("advance");
        expect(report.removed.session).toBe(false);
        expect(
            calls.filter((call) => call.startsWith("observe") || call.startsWith("remove")),
        ).toEqual([]);
        expect((await read(state)).state).toBe("discarded");
    });

    it("stops at a taken that stays, naming the labels found and the removed session", async () => {
        const original = record();
        const { state, deps } = await setup({ records: [original] });
        const stubborn = {
            ...deps.trackers.linear,
            removeLabel: () => Promise.resolve({ ok: true as const, value: undefined }),
            readTask: (id: string) =>
                Promise.resolve({
                    ok: true as const,
                    value: task("linear", id, ["AFK", "taken"]),
                }),
        };

        const report = await discardAttempt(
            args("linear:DOT-109:test:1"),
            { ...deps, trackers: { ...deps.trackers, linear: stubborn } },
            STARTED,
        );

        expect(report.outcome).toBe("not-evaluable");
        expect(report.removed).toEqual({ session: true, taken: false, workspace: false });
        expect(report.reasons.at(-1)).toBe(
            "removing taken from linear:DOT-109 failed: taken still on linear:DOT-109 after removal: [AFK, taken]; the session was already removed",
        );
        expect(await read(state)).toEqual(original);
    });

    it("reports an unknown attempt as not evaluable", async () => {
        const { calls, deps } = await setup();

        const report = await discardAttempt(args("linear:DOT-109:test:2"), deps, STARTED);

        expect(report).toMatchObject({
            outcome: "not-evaluable",
            attempt: null,
            task: null,
            found: [],
            reasons: ["attempt linear:DOT-109:test:2 not found"],
        });
        expect(calls).toEqual([]);
    });

    it("refuses an attempt that is already discarded", async () => {
        const { calls, deps } = await setup({ records: [record({ state: "discarded" })] });

        const report = await discardAttempt(args("linear:DOT-109:test:1"), deps, STARTED);

        expect(report.outcome).toBe("not-evaluable");
        expect(report.reasons).toEqual(["attempt linear:DOT-109:test:1 is already discarded"]);
        expect(calls).toEqual([]);
    });

    it("names a malformed record instead of calling it missing", async () => {
        const { state, deps } = await setup();
        await writeFile(recordPath(attemptDir(state, "linear:DOT-109:test:1")), "{");

        const report = await discardAttempt(args("linear:DOT-109:test:1"), deps, STARTED);

        expect(report.outcome).toBe("not-evaluable");
        expect(report.reasons[0]).toContain("is not valid JSON");
    });

    it("rejects a value that is neither an attempt nor a task reference", async () => {
        const { deps } = await setup();

        const report = await discardAttempt(args("DOT-109"), deps, STARTED);

        expect(report.outcome).toBe("not-evaluable");
        expect(report.reasons).toEqual(["not an attempt or task reference: DOT-109"]);
    });
});

describe("discardAttempt by task id", () => {
    it("discards the task's single open attempt", async () => {
        const closed = record({
            id: "linear:DOT-109:test:1",
            state: "completed",
            session: null,
        });
        const open = record({ id: "linear:DOT-109:test:2", attempt: 2, state: "retained" });
        const { state, deps } = await setup({ records: [closed, open] });

        const report = await discardAttempt(args("linear:DOT-109"), deps, STARTED);

        expect(report.outcome).toBe("advance");
        expect(report.attempt).toBe("linear:DOT-109:test:2");
        expect((await read(state, "linear:DOT-109:test:2")).state).toBe("discarded");
        expect((await read(state, "linear:DOT-109:test:1")).state).toBe("completed");
    });

    it("lists both attempts of a task with two open ones and changes nothing", async () => {
        const first = record();
        const second = record({ id: "linear:DOT-109:test:2", attempt: 2, state: "retained" });
        const { state, calls, deps } = await setup({ records: [first, second] });

        const report = await discardAttempt(args("linear:DOT-109"), deps, STARTED);

        expect(report).toMatchObject({
            outcome: "not-evaluable",
            attempt: null,
            found: ["linear:DOT-109:test:1", "linear:DOT-109:test:2"],
            reasons: [
                "2 open attempts of linear:DOT-109: linear:DOT-109:test:1, linear:DOT-109:test:2",
            ],
        });
        expect(calls).toEqual([]);
        expect(await read(state, "linear:DOT-109:test:1")).toEqual(first);
        expect(await read(state, "linear:DOT-109:test:2")).toEqual(second);
    });

    it("reports a task with no open attempt, listing the attempts it has", async () => {
        const done = record({ state: "completed" });
        const { calls, deps } = await setup({ records: [done] });

        const report = await discardAttempt(args("linear:DOT-109"), deps, STARTED);

        expect(report).toMatchObject({
            outcome: "not-evaluable",
            found: ["linear:DOT-109:test:1"],
            reasons: ["no open attempt of linear:DOT-109"],
        });
        expect(calls).toEqual([]);
    });

    it("reports a task that has no attempt at all", async () => {
        const { deps } = await setup({ records: [] });

        const report = await discardAttempt(args("linear:DOT-109"), deps, STARTED);

        expect(report).toMatchObject({
            outcome: "not-evaluable",
            found: [],
            reasons: ["no open attempt of linear:DOT-109"],
        });
    });

    it("ignores the open attempts of another task", async () => {
        const other = record({
            id: "linear:DOT-110:test:1",
            task: { source: "linear", id: "DOT-110", title: "Other" },
        });
        const { deps } = await setup({ records: [other] });

        const report = await discardAttempt(args("linear:DOT-109"), deps, STARTED);

        expect(report.found).toEqual([]);
    });
});

describe("reports", () => {
    it("renders the text of a discard", async () => {
        const { deps } = await setup();
        const report = await discardAttempt(args("linear:DOT-109:test:1"), deps, STARTED);

        expect(renderDiscardText(report)).toBe(
            [
                "autonomous discard — started 2026-10-17T13:00:00.000Z",
                "outcome: advance",
                "attempt: linear:DOT-109:test:1",
                "task: linear:DOT-109",
                "removed: session yes, taken yes, workspace no",
                "reasons:",
                "  session ef3fde3ca69c4b8b removed",
                "  taken removed from linear:DOT-109",
                "  attempt linear:DOT-109:test:1 discarded",
            ].join("\n"),
        );
    });

    it("lists what was found in the text", async () => {
        const { deps } = await setup({
            records: [record(), record({ id: "linear:DOT-109:test:2", attempt: 2 })],
        });
        const report = await discardAttempt(args("linear:DOT-109"), deps, STARTED);

        expect(renderDiscardText(report)).toContain(
            "found:\n  linear:DOT-109:test:1\n  linear:DOT-109:test:2\nreasons:",
        );
    });

    it("renders the JSON as one document of schema autonomous.discard.v1", async () => {
        const { deps } = await setup();
        const report = await discardAttempt(args("linear:DOT-109:test:1"), deps, STARTED);

        const parsed: unknown = JSON.parse(renderDiscardJson(report));

        expect(parsed).toEqual(report);
        expect(parsed).toMatchObject({ schema: DISCARD_SCHEMA, outcome: "advance" });
        expect(DISCARD_SCHEMA).toBe("autonomous.discard.v1");
    });

    it("yields one not-evaluable document when the configuration failed to load", () => {
        const report = unconfiguredDiscard("/c.json", "bad config", STARTED);

        expect(report).toMatchObject({
            schema: "autonomous.discard.v1",
            outcome: "not-evaluable",
            attempt: null,
            task: null,
            found: [],
            removed: { session: false, taken: false, workspace: false },
            config: { path: "/c.json", error: "bad config" },
        });
        expect(renderDiscardText(report)).toContain("  bad config");
    });
});
