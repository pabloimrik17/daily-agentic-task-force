import { existsSync, readFileSync, rmSync } from "node:fs";
import { writeFile } from "node:fs/promises";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { RunArgs } from "../args.ts";
import { task, trackers } from "../label-triage/test-fixtures.ts";
import type { PullRequest, PullRequests } from "../pull-request/port.ts";
import type { Observed, SessionManager } from "../sessions/manager.ts";
import type { WorkspaceManager } from "../workspace/manager.ts";
import {
    DISCARD_SCHEMA,
    discardAttempt,
    renderDiscardJson,
    renderDiscardText,
    unconfiguredDiscard,
    withDefaults,
} from "./discard.ts";
import type { AttemptId, AttemptRecord } from "./record.ts";
import {
    attemptDir,
    capturePath,
    logbookReceiptPath,
    readRecord,
    recordPath,
    writeRecord,
} from "./state.ts";
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
    vi.useRealTimers();
    published.length = 0;
    for (const state of states.splice(0)) {
        rmSync(state, { recursive: true, force: true });
    }
});

// The discard reads the state from disk before the read-back waits, so the fake clock advances
// until it settles instead of once.
async function withoutSleeping<T>(pending: Promise<T>): Promise<T> {
    let settled = false;
    const done = () => {
        settled = true;
    };
    void pending.then(done, done);
    while (!settled) {
        await vi.advanceTimersByTimeAsync(1000);
    }
    return pending;
}

function args(discard: string, releaseWorkspace = false): RunArgs {
    return {
        account: undefined,
        task: undefined,
        stage: undefined,
        discard,
        transition: undefined,
        persist: undefined,
        pullRequest: undefined,
        title: undefined,
        log: undefined,
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
    labels?: string[];
    pullRequest?: Partial<PullRequests>;
}

const OPEN_PULL_REQUEST: PullRequest = {
    number: 7,
    url: "https://example.test/pull/7",
    title: "t",
};
const MARKER = "<!-- autonomous:logbook linear:DOT-109:test:1 -->";

// Its calls go to their own log, so the shared `calls` of the other tests stay what they assert.
function fakePullRequests(script: Partial<PullRequests>, calls: string[]): PullRequests {
    const unexpected = (method: string) => () =>
        Promise.resolve({ ok: false as const, error: `${method} was not expected` });
    return {
        defaultBranch: unexpected("defaultBranch"),
        find: (branch) => {
            calls.push(`find ${branch}`);
            return script.find?.(branch) ?? Promise.resolve({ ok: true, value: null });
        },
        ahead: unexpected("ahead"),
        commitsSince: unexpected("commitsSince"),
        emptyCommit: unexpected("emptyCommit"),
        push: unexpected("push"),
        open: unexpected("open"),
        edit: unexpected("edit"),
        comment: (number, file) => {
            calls.push(`comment ${number}`);
            const body = readFileSync(file, "utf8");
            published.push(body);
            return (
                script.comment?.(number, file) ?? Promise.resolve({ ok: true, value: undefined })
            );
        },
        comments: (number) => {
            calls.push(`comments ${number}`);
            return script.comments?.(number) ?? Promise.resolve({ ok: true, value: [] });
        },
    };
}

const published: string[] = [];

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
        capture: () => Promise.resolve({ ok: true, value: "the pane" }),
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
    const pullRequestCalls: string[] = [];
    const directories: string[] = [];
    const deps = {
        state,
        sessions,
        workspace,
        trackers: trackers(calls, { linear: tasks }),
        pullRequests: (directory: string) => {
            directories.push(directory);
            return fakePullRequests(options.pullRequest ?? {}, pullRequestCalls);
        },
        now: () => LATER,
    };
    return { state, calls, deps, workspace, pullRequestCalls, directories };
}

const read = (state: string, id: AttemptId = "linear:DOT-109:test:1") =>
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
            "capture ef3fde3ca69c4b8b 200",
            "remove ef3fde3ca69c4b8b",
            "linear:readTask:DOT-109",
            "linear:removeLabel:DOT-109:taken",
            "linear:readTask:DOT-109",
        ]);
        expect(deps.workspace.calls).toEqual([]);
    });

    it("saves the capture and the conversation id before it removes a live session", async () => {
        const { state, calls, deps } = await setup({
            sessions: {
                observe: () =>
                    Promise.resolve({ ok: true, value: { ...OPEN, agentSessionId: "conv-7" } }),
            },
        });

        await discardAttempt(args("linear:DOT-109:test:1"), deps, STARTED);

        expect(calls.slice(0, 3)).toEqual([
            "observe ef3fde3ca69c4b8b",
            "capture ef3fde3ca69c4b8b 200",
            "remove ef3fde3ca69c4b8b",
        ]);
        const file = capturePath(attemptDir(state, "linear:DOT-109:test:1"));
        expect(readFileSync(file, "utf8")).toBe("the pane");
        expect((await read(state)).session?.agentSessionId).toBe("conv-7");
    });

    it("keeps an earlier conversation id when the session reports none", async () => {
        const original = record();
        const session = original.session && { ...original.session, agentSessionId: "conv-1" };
        const { state, deps } = await setup({ records: [{ ...original, session }] });

        await discardAttempt(args("linear:DOT-109:test:1"), deps, STARTED);

        expect((await read(state)).session?.agentSessionId).toBe("conv-1");
    });

    it("discards anyway when the capture fails, and says so", async () => {
        const { state, calls, deps } = await setup({
            sessions: { capture: () => Promise.resolve({ ok: false, error: "aoe: no pane" }) },
        });

        const report = await discardAttempt(args("linear:DOT-109:test:1"), deps, STARTED);

        expect(report.outcome).toBe("advance");
        expect(report.removed.session).toBe(true);
        expect(report.reasons).toContain(
            "capture of session ef3fde3ca69c4b8b failed: aoe: no pane",
        );
        expect(calls).toContain("remove ef3fde3ca69c4b8b");
        expect(existsSync(capturePath(attemptDir(state, "linear:DOT-109:test:1")))).toBe(false);
        expect((await read(state)).state).toBe("discarded");
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
            "capture ef3fde3ca69c4b8b 200",
            "remove ef3fde3ca69c4b8b",
            "linear:readTask:DOT-109",
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
        vi.useFakeTimers();
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

        const report = await withoutSleeping(
            discardAttempt(
                args("linear:DOT-109:test:1"),
                { ...deps, trackers: { ...deps.trackers, linear: stubborn } },
                STARTED,
            ),
        );

        expect(report.outcome).toBe("not-evaluable");
        expect(report.removed).toEqual({ session: true, taken: false, workspace: false });
        expect(report.reasons.at(-1)).toBe(
            "removing taken from linear:DOT-109 failed: taken still on linear:DOT-109 after removal: [AFK, taken] (read 6 times over 30 s); the session was already removed",
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

    it.each(["completed", "aborted"] as const)(
        "refuses a %s attempt without a pending cleanup and changes nothing",
        async (state) => {
            const original = record({ state, session: null });
            const { state: dir, calls, deps } = await setup({ records: [original] });

            const report = await discardAttempt(args("linear:DOT-109:test:1"), deps, STARTED);

            expect(report.outcome).toBe("not-evaluable");
            expect(report.reasons).toEqual([
                `attempt linear:DOT-109:test:1 is ${state}; nothing to discard`,
            ]);
            expect(calls).toEqual([]);
            expect(await read(dir)).toEqual(original);
        },
    );

    it("still discards a completed attempt with a pending cleanup", async () => {
        const { state, deps } = await setup({
            records: [
                record({ state: "completed", cleanup: { pending: true, error: "aoe: busy" } }),
            ],
        });

        const report = await discardAttempt(args("linear:DOT-109:test:1"), deps, STARTED);

        expect(report.outcome).toBe("advance");
        expect(report.removed).toMatchObject({ session: true, taken: true });
        expect(await read(state)).toMatchObject({ state: "discarded", cleanup: null });
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

describe("the discard entry", () => {
    const retained = () => record({ state: "retained", retained: { at: "t", reason: "exited" } });
    const withPullRequest: Partial<PullRequests> = {
        find: () => Promise.resolve({ ok: true, value: OPEN_PULL_REQUEST }),
    };

    it("comments once on the open pull request of a retained attempt without a receipt", async () => {
        const { deps, pullRequestCalls } = await setup({
            records: [retained()],
            pullRequest: withPullRequest,
        });

        const report = await discardAttempt(args("linear:DOT-109:test:1"), deps, STARTED);

        expect(report.outcome).toBe("advance");
        expect(report.notes).toEqual([]);
        expect(pullRequestCalls).toEqual([
            "find feature/DOT-109-stage-session-manager",
            "comments 7",
            "comment 7",
        ]);
        expect(published).toHaveLength(1);
        expect(published[0]).toContain(MARKER);
        expect(published[0]).toContain("🧪 test · attempt 1 · discarded");
        expect(published[0]).toContain("Discarded at 2026-10-17 13:00 UTC.");
    });

    it("makes the port for the repository, not the worktree", async () => {
        const { deps, directories } = await setup({ pullRequest: withPullRequest });

        await discardAttempt(args("linear:DOT-109:test:1", true), deps, STARTED);

        expect(directories).toEqual(["/w/dotfiles"]);
    });

    it("publishes nothing when the branch has no pull request, and the discard succeeds", async () => {
        const { state, deps, pullRequestCalls } = await setup({ records: [retained()] });

        const report = await discardAttempt(args("linear:DOT-109:test:1"), deps, STARTED);

        expect(report.outcome).toBe("advance");
        expect(report.notes).toEqual([]);
        expect(pullRequestCalls).toEqual(["find feature/DOT-109-stage-session-manager"]);
        expect(published).toEqual([]);
        expect((await read(state)).state).toBe("discarded");
    });

    it("keeps the discard and notes the failed command when the comment fails", async () => {
        const { state, deps } = await setup({
            records: [retained()],
            pullRequest: {
                ...withPullRequest,
                comment: () =>
                    Promise.resolve({ ok: false, error: "gh pr comment 7 failed: HTTP 502" }),
            },
        });

        const report = await discardAttempt(args("linear:DOT-109:test:1"), deps, STARTED);

        expect(report.outcome).toBe("advance");
        expect(report.notes).toEqual([
            "discard entry not published: gh pr comment 7 failed: HTTP 502",
        ]);
        expect((await read(state)).state).toBe("discarded");
        expect(renderDiscardText(report)).toContain(
            "notes:\n  discard entry not published: gh pr comment 7 failed: HTTP 502",
        );
    });

    it("notes a failed lookup and still discards", async () => {
        const { deps } = await setup({
            pullRequest: { find: () => Promise.resolve({ ok: false, error: "gh pr list failed" }) },
        });

        const report = await discardAttempt(args("linear:DOT-109:test:1"), deps, STARTED);

        expect(report.outcome).toBe("advance");
        expect(report.notes).toEqual(["discard entry not published: gh pr list failed"]);
    });

    it("does not even look for a pull request when the attempt has a receipt", async () => {
        const { state, deps, pullRequestCalls, directories } = await setup({
            records: [retained()],
            pullRequest: withPullRequest,
        });
        await writeFile(logbookReceiptPath(attemptDir(state, "linear:DOT-109:test:1")), "{}");

        const report = await discardAttempt(args("linear:DOT-109:test:1"), deps, STARTED);

        expect(report.outcome).toBe("advance");
        expect(report.notes).toEqual([]);
        expect(pullRequestCalls).toEqual([]);
        expect(directories).toEqual([]);
    });

    it("publishes no second entry when the pull request already carries one", async () => {
        const { deps, pullRequestCalls } = await setup({
            records: [retained()],
            pullRequest: {
                ...withPullRequest,
                comments: () => Promise.resolve({ ok: true, value: [`${MARKER}\n### entry`] }),
            },
        });

        const report = await discardAttempt(args("linear:DOT-109:test:1"), deps, STARTED);

        expect(report.outcome).toBe("advance");
        expect(pullRequestCalls).toEqual([
            "find feature/DOT-109-stage-session-manager",
            "comments 7",
        ]);
        expect(published).toEqual([]);
    });

    it("runs only when every earlier step succeeded", async () => {
        const { deps, directories } = await setup({
            pullRequest: withPullRequest,
            workspace: { release: () => Promise.resolve({ ok: false, error: "wt: dirty" }) },
        });

        const report = await discardAttempt(args("linear:DOT-109:test:1", true), deps, STARTED);

        expect(report.outcome).toBe("not-evaluable");
        expect(directories).toEqual([]);
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

    it("resolves a completed attempt with a pending cleanup", async () => {
        const owing = record({
            state: "completed",
            cleanup: { pending: true, error: "aoe: busy" },
        });
        const { state, deps } = await setup({ records: [owing] });

        const report = await discardAttempt(args("linear:DOT-109"), deps, STARTED);

        expect(report.outcome).toBe("advance");
        expect(report.attempt).toBe("linear:DOT-109:test:1");
        expect(await read(state)).toMatchObject({ state: "discarded", cleanup: null });
    });

    it("still refuses a completed attempt without a pending cleanup", async () => {
        const done = record({ state: "completed", cleanup: null });
        const { state, calls, deps } = await setup({ records: [done] });

        const report = await discardAttempt(args("linear:DOT-109"), deps, STARTED);

        expect(report).toMatchObject({
            outcome: "not-evaluable",
            found: ["linear:DOT-109:test:1"],
            reasons: ["no open attempt of linear:DOT-109"],
        });
        expect(calls).toEqual([]);
        expect(await read(state)).toEqual(done);
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

    it("shows the defaulted keys in the text and the JSON, and nothing when there are none", async () => {
        const { deps } = await setup();
        const report = await discardAttempt(args("linear:DOT-109:test:1"), deps, STARTED);

        const defaulted = withDefaults(report, ["sessions.tool", "workspace.root"]);
        expect(renderDiscardText(defaulted).split("\n").slice(0, 3)).toEqual([
            "autonomous discard — started 2026-10-17T13:00:00.000Z",
            "outcome: advance",
            "defaults: sessions.tool, workspace.root",
        ]);
        expect(JSON.parse(renderDiscardJson(defaulted))).toMatchObject({
            config: { defaulted: ["sessions.tool", "workspace.root"] },
        });

        expect(withDefaults(report, [])).toBe(report);
        expect(renderDiscardText(report)).not.toContain("defaults:");
        expect(JSON.parse(renderDiscardJson(report))).not.toHaveProperty("config");
    });
});
