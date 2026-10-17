import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ConfigLoad } from "../config.ts";
import { task, trackers, triageContext } from "../label-triage/test-fixtures.ts";
import type { Trackers } from "../label-triage/trackers/tracker.ts";
import { NOW } from "../quota-gate/test-fixtures.ts";
import type { RunContext } from "../runner.ts";
import { mapStatus } from "../sessions/aoe.ts";
import type { Observed, SessionManager } from "../sessions/manager.ts";
import type { AttemptRecord } from "./record.ts";
import { reconcileStep } from "./reconcile.ts";
import { RESULT_SCHEMA } from "./result.ts";
import {
    attemptDir,
    capturePath,
    readRecord,
    recordPath,
    resultPath,
    writeJsonAtomic,
    writeRecord,
} from "./state.ts";
import { fakeSessions, record, tempState } from "./test-fixtures.ts";

const AT = NOW.toISOString();
const SESSION = "ef3fde3ca69c4b8b";
const AGENT = "4daf1b40-6249-4a25-bdd7-0a69bc77e342";
const ID = "linear:DOT-109:test:1";
const PATH = "/w/dotfiles-worktrees/feature-DOT-109-stage-session-manager";
const TITLE = "auto 🧪 Stage session manager (DOT-109)";

// A session listed at the workspace path, titled as the record names it unless told otherwise.
const listed = (id: string, title = TITLE) => ({ id, title });

let state: string;

beforeEach(() => {
    state = tempState();
});

afterEach(() => {
    rmSync(state, { recursive: true, force: true });
});

// What the AoE adapter reports for a status word (design D3); `gone` is a missing session.
function seen(status: string): Observed {
    if (status === "gone") {
        return {
            state: "gone",
            status: "not found",
            busy: false,
            needsHuman: false,
            agentSessionId: null,
        };
    }
    return { ...mapStatus(status), status, agentSessionId: AGENT };
}

const ok = <T>(value: T) => Promise.resolve({ ok: true as const, value });
const fail = (error: string) => Promise.resolve({ ok: false as const, error });

function linear(calls: string[], labels = ["taken", "grill-me"]): Trackers {
    return trackers(calls, { linear: [task("linear", "DOT-109", labels)] });
}

// A tracker whose `removeLabel` command fails, as a CLI error would.
function failingRemoval(calls: string[]): Trackers {
    const fakes = linear(calls);
    fakes.linear = {
        ...fakes.linear,
        removeLabel: (id, label) => {
            calls.push(`linear:removeLabel:${id}:${label}`);
            return fail(`linear issue update ${id} --remove-label ${label}: network down`);
        },
    };
    return fakes;
}

function context(options: {
    sessions: SessionManager;
    trackers: Trackers;
    apply?: boolean;
    config?: ConfigLoad;
}): RunContext {
    const base = triageContext({
        trackers: options.trackers,
        args: { apply: options.apply ?? true },
        ...(options.config === undefined ? {} : { config: options.config }),
    });
    return { ...base, io: { ...base.io, sessions: () => options.sessions, state } };
}

async function given(...records: AttemptRecord[]): Promise<void> {
    for (const each of records) {
        await writeRecord(state, each);
    }
}

async function marker(id = ID, attempt = id): Promise<void> {
    await writeJsonAtomic(resultPath(attemptDir(state, id)), {
        schema: RESULT_SCHEMA,
        attempt,
        outcome: "completed",
        summary: "Wrote the marker.",
        artifacts: [],
        finishedAt: "2026-09-23T11:59:00.000Z",
    });
}

const stored = (id = ID) => readRecord(recordPath(attemptDir(state, id)));
const rawRecord = (id = ID) => readFileSync(recordPath(attemptDir(state, id)), "utf8");
const captured = (id = ID) => capturePath(attemptDir(state, id));

const pending = (overrides: Partial<AttemptRecord> = {}) =>
    record({
        state: "pending",
        history: [{ state: "pending", at: "2026-10-17T12:00:00.000Z" }],
        session: { ...record().session!, id: null },
        ...overrides,
    });

describe("reconcile: the step", () => {
    it("is advance with nothing to reconcile and builds no session manager", async () => {
        const base = triageContext({ trackers: linear([]), args: { apply: true } });
        let built = 0;
        const ctx: RunContext = {
            ...base,
            io: {
                ...base.io,
                state,
                sessions: () => {
                    built++;
                    return fakeSessions({});
                },
            },
        };
        const result = await reconcileStep.run(ctx);
        expect(result).toEqual({
            step: "reconcile",
            tier: "code",
            outcome: "advance",
            reasons: ["nothing to reconcile"],
            data: { attempts: [], retained: [], cleanups: [], needsHuman: [], errors: [] },
        });
        expect(built).toBe(0);
    });

    it("is not evaluable with the configuration error", async () => {
        await given(record());
        const sessions = fakeSessions({});
        const result = await reconcileStep.run(
            context({
                sessions,
                trackers: linear([]),
                config: { ok: false, path: "/home/me/config.json", error: "no configuration" },
            }),
        );
        expect(result.outcome).toBe("not-evaluable");
        expect(result.reasons).toEqual(["no configuration"]);
        expect(sessions.calls).toEqual([]);
    });

    it("is not evaluable naming the file of a malformed record, changing nothing", async () => {
        await given(
            record({ id: "linear:DOT-200:test:1", task: { ...record().task, id: "DOT-200" } }),
        );
        const dir = attemptDir(state, ID);
        await mkdir(dir, { recursive: true });
        writeFileSync(recordPath(dir), "{ not json");
        const sessions = fakeSessions({});
        const result = await reconcileStep.run(context({ sessions, trackers: linear([]) }));
        expect(result.outcome).toBe("not-evaluable");
        expect(result.reasons).toHaveLength(1);
        expect(result.reasons[0]).toContain(recordPath(dir));
        expect(sessions.calls).toEqual([]);
    });

    it("finalises a completed stage, as it runs before the quota gate", async () => {
        await given(record());
        await marker();
        const sessions = fakeSessions({
            observe: () => ok(seen("idle")),
            capture: () => ok("pane"),
            remove: () => ok(undefined),
        });
        const result = await reconcileStep.run(context({ sessions, trackers: linear([]) }));
        expect(result.outcome).toBe("advance");
        expect(result.data.attempts[0]?.action).toBe("finalised");
        expect((await stored()).state).toBe("completed");
    });

    it("is not evaluable naming the command when the session manager cannot be read", async () => {
        await given(record());
        const before = rawRecord();
        const sessions = fakeSessions({
            observe: () =>
                fail("aoe session show ef3fde3ca69c4b8b --json: aoe CLI not found on PATH"),
        });
        const result = await reconcileStep.run(context({ sessions, trackers: linear([]) }));
        expect(result.outcome).toBe("not-evaluable");
        expect(result.reasons).toEqual([
            `${ID}: aoe session show ef3fde3ca69c4b8b --json: aoe CLI not found on PATH`,
        ]);
        expect(result.data.errors).toEqual(result.reasons);
        expect(result.data.attempts[0]).toMatchObject({
            before: "started",
            state: "started",
            action: "none",
        });
        expect(rawRecord()).toBe(before);
    });

    it("writes nothing without --apply and reports what it would do", async () => {
        await given(record());
        await marker();
        const before = rawRecord();
        const calls: string[] = [];
        const sessions = fakeSessions({ calls, observe: () => ok(seen("idle")) });
        const result = await reconcileStep.run(
            context({ sessions, trackers: linear(calls), apply: false }),
        );
        expect(result.outcome).toBe("advance");
        expect(result.data.attempts[0]).toMatchObject({
            before: "started",
            state: "started",
            action: "finalised",
            marker: { ok: true },
        });
        expect(result.reasons).toEqual([
            "1 attempt observed",
            "1 would-finalise",
            "nothing changed",
        ]);
        expect(calls).toEqual([`observe ${SESSION}`, "linear:readTask:DOT-109"]);
        expect(rawRecord()).toBe(before);
        expect(existsSync(captured())).toBe(false);
    });

    it("reports a pending recovery without --apply and writes nothing", async () => {
        await given(pending());
        const before = rawRecord();
        const calls: string[] = [];
        const sessions = fakeSessions({ calls, findByPath: () => ok([]) });
        const result = await reconcileStep.run(
            context({ sessions, trackers: linear(calls), apply: false }),
        );
        expect(result.data.attempts[0]).toMatchObject({
            before: "pending",
            state: "pending",
            action: "aborted",
        });
        expect(calls).toEqual([`findByPath ${PATH}`]);
        expect(rawRecord()).toBe(before);
    });
});

describe("reconcile: observed session state", () => {
    it("reports a waiting session as open and needing a person, changing nothing", async () => {
        await given(record());
        const sessions = fakeSessions({ observe: () => ok(seen("waiting")) });
        const result = await reconcileStep.run(context({ sessions, trackers: linear([]) }));
        expect(result.data.attempts[0]).toMatchObject({
            state: "started",
            session: { state: "open", status: "waiting", busy: false, needsHuman: true },
            action: "observed",
        });
        expect(result.data.needsHuman).toEqual([ID]);
        expect(result.reasons).toEqual([
            "1 attempt observed",
            "1 attempt needs a person",
            "nothing changed",
        ]);
        const after = await stored();
        expect(after.state).toBe("started");
        expect(after.observed).toEqual({
            status: "waiting",
            state: "open",
            needsHuman: true,
            at: AT,
        });
        expect(sessions.calls).toEqual([`observe ${SESSION}`]);
    });

    it("keeps an idle session without a result started and says so", async () => {
        await given(record());
        const sessions = fakeSessions({ observe: () => ok(seen("idle")) });
        const result = await reconcileStep.run(context({ sessions, trackers: linear([]) }));
        expect(result.data.attempts[0]).toMatchObject({
            state: "started",
            session: { status: "idle", state: "open" },
            marker: { ok: false, reason: "no result marker" },
            action: "observed",
        });
        expect((await stored()).state).toBe("started");
    });

    it("treats an unknown session as open and changes nothing", async () => {
        await given(record());
        const sessions = fakeSessions({ observe: () => ok(seen("unknown")) });
        const result = await reconcileStep.run(context({ sessions, trackers: linear([]) }));
        expect(result.data.attempts[0]).toMatchObject({
            state: "started",
            session: { state: "open", status: "unknown", needsHuman: false },
            action: "observed",
        });
        expect(sessions.calls).toEqual([`observe ${SESSION}`]);
    });
});

describe("reconcile: completion needs two proofs", () => {
    it("counts a marker naming another attempt as absent", async () => {
        const second = record({ id: "linear:DOT-109:test:2", attempt: 2 });
        await given(second);
        await marker(second.id, ID);
        const sessions = fakeSessions({ observe: () => ok(seen("idle")) });
        const result = await reconcileStep.run(context({ sessions, trackers: linear([]) }));
        expect(result.data.attempts[0]).toMatchObject({
            id: second.id,
            state: "started",
            marker: {
                ok: false,
                reason: `result marker names attempt ${ID}, expected ${second.id}`,
            },
            action: "observed",
        });
    });

    it("does not complete when the tracker check holds but no marker was written", async () => {
        await given(record());
        const calls: string[] = [];
        const sessions = fakeSessions({ calls, observe: () => ok(seen("idle")) });
        const result = await reconcileStep.run(context({ sessions, trackers: linear(calls) }));
        expect(result.data.attempts[0]?.action).toBe("observed");
        expect(calls).not.toContain(`remove ${SESSION}`);
        expect((await stored()).state).toBe("started");
    });

    it("does not complete a stage without an implementation", async () => {
        const unknown = record({ id: "linear:DOT-109:grill-me:1", stage: "grill-me" });
        await given(unknown);
        await marker(unknown.id);
        const sessions = fakeSessions({
            observe: () => ok(seen("stopped")),
            capture: () => ok("pane"),
        });
        const result = await reconcileStep.run(context({ sessions, trackers: linear([]) }));
        expect(result.data.attempts[0]).toMatchObject({
            marker: { ok: true },
            action: "retained",
        });
        expect((await stored(unknown.id)).retained?.reason).toBe(
            "session stopped; stage grill-me has no implementation",
        );
    });

    it("makes an attempt with both proofs eligible for finalisation", async () => {
        await given(record());
        await marker();
        const sessions = fakeSessions({
            observe: () => ok(seen("idle")),
            capture: () => ok("pane"),
            remove: () => ok(undefined),
        });
        const result = await reconcileStep.run(context({ sessions, trackers: linear([]) }));
        expect(result.data.attempts[0]).toMatchObject({
            marker: { ok: true },
            action: "finalised",
        });
    });

    it("is not evaluable when the task cannot be read for the tracker check", async () => {
        await given(record());
        await marker();
        const calls: string[] = [];
        const sessions = fakeSessions({ calls, observe: () => ok(seen("idle")) });
        const fakes = trackers(calls, { linear: [] });
        const result = await reconcileStep.run(context({ sessions, trackers: fakes }));
        expect(result.outcome).toBe("not-evaluable");
        expect(result.reasons).toEqual([`${ID}: DOT-109 not found`]);
        expect(calls).toEqual([`observe ${SESSION}`, "linear:readTask:DOT-109"]);
        expect((await stored()).state).toBe("started");
    });
});

describe("reconcile: finalisation", () => {
    it("leaves a running agent alone and reports it completing", async () => {
        await given(record());
        await marker();
        const calls: string[] = [];
        const sessions = fakeSessions({ calls, observe: () => ok(seen("running")) });
        const result = await reconcileStep.run(context({ sessions, trackers: linear(calls) }));
        expect(result.data.attempts[0]).toMatchObject({
            state: "started",
            session: { busy: true },
            action: "completing",
        });
        expect(calls).toEqual([`observe ${SESSION}`, "linear:readTask:DOT-109"]);
        expect((await stored()).state).toBe("started");
    });

    it("captures, removes, records completed and then removes taken, in that order", async () => {
        await given(record());
        await marker();
        const calls: string[] = [];
        let onDisk: AttemptRecord | null = null;
        const sessions = fakeSessions({
            calls,
            observe: () => ok(seen("idle")),
            capture: () => ok("the last lines"),
            remove: () => {
                onDisk = JSON.parse(rawRecord()) as AttemptRecord;
                return ok(undefined);
            },
        });
        const fakes = linear(calls);
        const result = await reconcileStep.run(context({ sessions, trackers: fakes }));
        expect(calls).toEqual([
            `observe ${SESSION}`,
            "linear:readTask:DOT-109",
            `capture ${SESSION} 200`,
            `remove ${SESSION}`,
            "linear:readTask:DOT-109",
            "linear:removeLabel:DOT-109:taken",
            "linear:readTask:DOT-109",
        ]);
        expect(result.outcome).toBe("advance");
        expect(result.reasons).toEqual(["1 attempt observed", "1 finalised"]);
        const beforeRemove = onDisk as AttemptRecord | null;
        expect(beforeRemove?.state).toBe("started");
        expect(beforeRemove?.session?.agentSessionId).toBe(AGENT);
        const after = await stored();
        expect(after.state).toBe("completed");
        expect(after.history.at(-1)).toEqual({ state: "completed", at: AT });
        expect(after.session?.agentSessionId).toBe(AGENT);
        expect(after.taken.removed).toBe(AT);
        expect(after.cleanup).toBeNull();
        expect(readFileSync(captured(), "utf8")).toBe("the last lines");
        const labels = await fakes.linear.readTask("DOT-109");
        expect(labels.ok && labels.value.labels).toEqual(["grill-me"]);
    });

    it("finalises a gone session without capturing or removing it", async () => {
        await given(record());
        await marker();
        const calls: string[] = [];
        const sessions = fakeSessions({ calls, observe: () => ok(seen("gone")) });
        const result = await reconcileStep.run(context({ sessions, trackers: linear(calls) }));
        expect(result.data.attempts[0]?.action).toBe("finalised");
        expect(calls.filter((call) => !call.startsWith("linear:"))).toEqual([`observe ${SESSION}`]);
        expect((await stored()).state).toBe("completed");
    });

    it("keeps the conversation id saved earlier when the session is already gone", async () => {
        await given(record({ session: { ...record().session!, agentSessionId: AGENT } }));
        await marker();
        const sessions = fakeSessions({ observe: () => ok(seen("gone")) });
        await reconcileStep.run(context({ sessions, trackers: linear([]) }));
        expect((await stored()).session?.agentSessionId).toBe(AGENT);
    });

    it("keeps finalising when the capture fails, naming it in the detail", async () => {
        await given(record());
        await marker();
        const sessions = fakeSessions({
            observe: () => ok(seen("idle")),
            capture: () => fail("aoe session capture: pane gone"),
            remove: () => ok(undefined),
        });
        const result = await reconcileStep.run(context({ sessions, trackers: linear([]) }));
        expect(result.data.attempts[0]).toMatchObject({
            action: "finalised",
            detail: "capture failed: aoe session capture: pane gone",
        });
        expect(result.outcome).toBe("advance");
    });

    it("keeps finalising when the capture cannot be written, naming it in the detail", async () => {
        await given(record());
        await marker();
        await mkdir(captured());
        const sessions = fakeSessions({
            observe: () => ok(seen("idle")),
            capture: () => ok("the last lines"),
            remove: () => ok(undefined),
        });
        const result = await reconcileStep.run(context({ sessions, trackers: linear([]) }));
        expect(result.outcome).toBe("advance");
        expect(result.data.attempts[0]?.action).toBe("finalised");
        expect(result.data.attempts[0]?.detail).toMatch(/^saving the capture failed: .*EISDIR/);
        expect(sessions.calls).toEqual([
            `observe ${SESSION}`,
            `capture ${SESSION} 200`,
            `remove ${SESSION}`,
        ]);
        expect((await stored()).state).toBe("completed");
    });
});

describe("reconcile: pending cleanup", () => {
    it("records completed with the error and keeps taken when removal fails", async () => {
        await given(record());
        await marker();
        const calls: string[] = [];
        const sessions = fakeSessions({
            calls,
            observe: () => ok(seen("idle")),
            capture: () => ok("pane"),
            remove: () => fail("aoe remove ef3fde3ca69c4b8b --purge: busy"),
        });
        const result = await reconcileStep.run(context({ sessions, trackers: linear(calls) }));
        expect(result.outcome).toBe("advance");
        expect(result.data.attempts[0]).toMatchObject({
            state: "completed",
            action: "cleanup-pending",
        });
        expect(result.data.cleanups).toEqual([ID]);
        expect(result.reasons).toContain("1 cleanup pending");
        expect(calls).not.toContain("linear:removeLabel:DOT-109:taken");
        const after = await stored();
        expect(after.cleanup).toEqual({
            pending: true,
            error: "aoe remove ef3fde3ca69c4b8b --purge: busy",
        });
        expect(after.taken.removed).toBeNull();
    });

    it("keeps the cleanup pending when taken cannot be removed after the session was", async () => {
        await given(record());
        await marker();
        const calls: string[] = [];
        const sessions = fakeSessions({
            calls,
            observe: () => ok(seen("idle")),
            capture: () => ok("pane"),
            remove: () => ok(undefined),
        });
        const result = await reconcileStep.run(
            context({ sessions, trackers: failingRemoval(calls) }),
        );
        expect(result.data.attempts[0]).toMatchObject({
            state: "completed",
            action: "cleanup-pending",
        });
        const after = await stored();
        expect(after.cleanup?.error).toBe(
            "linear issue update DOT-109 --remove-label taken: network down",
        );
        expect(after.taken.removed).toBeNull();
    });

    it("clears the cleanup and removes taken on a later run", async () => {
        const error = "aoe remove ef3fde3ca69c4b8b --purge: busy";
        await given(record({ state: "completed", cleanup: { pending: true, error } }));
        const calls: string[] = [];
        const sessions = fakeSessions({
            calls,
            observe: () => ok(seen("idle")),
            remove: () => ok(undefined),
        });
        const result = await reconcileStep.run(context({ sessions, trackers: linear(calls) }));
        expect(calls).toEqual([
            `observe ${SESSION}`,
            `remove ${SESSION}`,
            "linear:readTask:DOT-109",
            "linear:removeLabel:DOT-109:taken",
            "linear:readTask:DOT-109",
        ]);
        expect(result.data.attempts[0]).toMatchObject({
            before: "completed",
            state: "completed",
            action: "cleanup-cleared",
        });
        expect(result.data.cleanups).toEqual([]);
        expect(result.reasons).toEqual(["1 attempt observed", "1 cleanup cleared"]);
        const after = await stored();
        expect(after.cleanup).toBeNull();
        expect(after.taken.removed).toBe(AT);
    });

    it("retries only taken when the session is already gone", async () => {
        const error = "linear issue update DOT-109 --remove-label taken: network down";
        await given(record({ state: "completed", cleanup: { pending: true, error } }));
        const calls: string[] = [];
        const sessions = fakeSessions({ calls, observe: () => ok(seen("gone")) });
        const result = await reconcileStep.run(context({ sessions, trackers: linear(calls) }));
        expect(calls).toEqual([
            `observe ${SESSION}`,
            "linear:readTask:DOT-109",
            "linear:removeLabel:DOT-109:taken",
            "linear:readTask:DOT-109",
        ]);
        expect(result.data.attempts[0]?.action).toBe("cleanup-cleared");
    });

    it("updates the cleanup error when the removal fails again", async () => {
        await given(record({ state: "completed", cleanup: { pending: true, error: "first" } }));
        const sessions = fakeSessions({
            observe: () => ok(seen("stopped")),
            remove: () => fail("aoe remove: second"),
        });
        const result = await reconcileStep.run(context({ sessions, trackers: linear([]) }));
        expect(result.data.attempts[0]).toMatchObject({
            action: "cleanup-pending",
            detail: "aoe remove: second",
        });
        expect((await stored()).cleanup).toEqual({ pending: true, error: "aoe remove: second" });
    });

    it("reports a pending cleanup without --apply, running no command", async () => {
        await given(record({ state: "completed", cleanup: { pending: true, error: "busy" } }));
        const sessions = fakeSessions({});
        const result = await reconcileStep.run(
            context({ sessions, trackers: linear([]), apply: false }),
        );
        expect(result.data.attempts[0]).toMatchObject({
            action: "cleanup-pending",
            detail: "busy",
        });
        expect(result.data.cleanups).toEqual([ID]);
        expect(sessions.calls).toEqual([]);
    });
});

describe("reconcile: retained attempts", () => {
    it("retains a stopped session without a result, with a capture, keeping taken", async () => {
        await given(record());
        const calls: string[] = [];
        const sessions = fakeSessions({
            calls,
            observe: () => ok(seen("stopped")),
            capture: () => ok("the last lines"),
        });
        const result = await reconcileStep.run(context({ sessions, trackers: linear(calls) }));
        expect(result.data.attempts[0]).toMatchObject({ state: "retained", action: "retained" });
        expect(result.data.retained).toEqual([ID]);
        expect(calls).toEqual([`observe ${SESSION}`, `capture ${SESSION} 200`]);
        const after = await stored();
        expect(after.state).toBe("retained");
        expect(after.retained).toEqual({ at: AT, reason: "session stopped; no result marker" });
        expect(after.taken.removed).toBeNull();
        expect(readFileSync(captured(), "utf8")).toBe("the last lines");
    });

    it("retains a gone session without capturing it", async () => {
        await given(record());
        const sessions = fakeSessions({ observe: () => ok(seen("gone")) });
        await reconcileStep.run(context({ sessions, trackers: linear([]) }));
        expect((await stored()).retained?.reason).toBe("session not found; no result marker");
        expect(existsSync(captured())).toBe(false);
        expect(sessions.calls).toEqual([`observe ${SESSION}`]);
    });

    it("lists a retained attempt on later runs and touches nothing", async () => {
        const retained = record({
            state: "retained",
            retained: {
                at: "2026-09-22T12:00:00.000Z",
                reason: "session stopped; no result marker",
            },
        });
        await given(retained);
        const before = rawRecord();
        const calls: string[] = [];
        const sessions = fakeSessions({ calls });
        const result = await reconcileStep.run(context({ sessions, trackers: linear(calls) }));
        expect(result.outcome).toBe("advance");
        expect(result.data.retained).toEqual([ID]);
        expect(result.data.attempts[0]).toMatchObject({
            before: "retained",
            state: "retained",
            action: "none",
        });
        expect(result.reasons).toEqual(["1 retained", "nothing changed"]);
        expect(calls).toEqual([]);
        expect(rawRecord()).toBe(before);
    });
});

describe("reconcile: recovery of a pending attempt", () => {
    it("adopts the one session at the workspace path, creating nothing", async () => {
        await given(pending());
        const sessions = fakeSessions({ findByPath: () => ok([listed(SESSION)]) });
        const result = await reconcileStep.run(context({ sessions, trackers: linear([]) }));
        expect(result.data.attempts[0]).toMatchObject({
            before: "pending",
            state: "created",
            action: "adopted",
            detail: SESSION,
        });
        expect(sessions.calls).toEqual([`findByPath ${PATH}`]);
        const after = await stored();
        expect(after.state).toBe("created");
        expect(after.session?.id).toBe(SESSION);
        expect(after.history.at(-1)).toEqual({ state: "created", at: AT });
    });

    it("removes taken and aborts when no session has the path", async () => {
        await given(pending());
        const calls: string[] = [];
        const sessions = fakeSessions({ calls, findByPath: () => ok([]) });
        const result = await reconcileStep.run(context({ sessions, trackers: linear(calls) }));
        expect(result.data.attempts[0]).toMatchObject({ state: "aborted", action: "aborted" });
        expect(calls).toEqual([
            `findByPath ${PATH}`,
            "linear:readTask:DOT-109",
            "linear:removeLabel:DOT-109:taken",
            "linear:readTask:DOT-109",
        ]);
        const after = await stored();
        expect(after.state).toBe("aborted");
        expect(after.taken.removed).toBe(AT);
    });

    it("adopts the session with the recorded title among those at the path", async () => {
        await given(pending());
        const sessions = fakeSessions({
            findByPath: () => ok([listed("manual0000000000", "my own session"), listed(SESSION)]),
        });
        const result = await reconcileStep.run(context({ sessions, trackers: linear([]) }));
        expect(result.data.attempts[0]).toMatchObject({ action: "adopted", detail: SESSION });
        expect((await stored()).session?.id).toBe(SESSION);
    });

    it("never adopts a session at the path with another title, and aborts", async () => {
        await given(pending());
        const calls: string[] = [];
        const sessions = fakeSessions({
            calls,
            findByPath: () => ok([listed("manual0000000000", "my own session")]),
        });
        const result = await reconcileStep.run(context({ sessions, trackers: linear(calls) }));
        expect(result.data.attempts[0]).toMatchObject({ state: "aborted", action: "aborted" });
        expect(calls).toEqual([
            `findByPath ${PATH}`,
            "linear:readTask:DOT-109",
            "linear:removeLabel:DOT-109:taken",
            "linear:readTask:DOT-109",
        ]);
        const after = await stored();
        expect(after.state).toBe("aborted");
        expect(after.session?.id).toBeNull();
    });

    it("aborts without findByPath and reports a taken it never added, leaving it on the task", async () => {
        await given(pending({ taken: { added: null, removed: null } }));
        const calls: string[] = [];
        const sessions = fakeSessions({ calls, findByPath: () => ok([listed(SESSION)]) });
        const fakes = linear(calls);
        const result = await reconcileStep.run(context({ sessions, trackers: fakes }));
        expect(result.outcome).toBe("advance");
        expect(result.data.attempts[0]).toMatchObject({
            state: "aborted",
            action: "aborted",
            detail: "task still carries taken; remove it by hand if no other run holds it",
        });
        expect(calls).toEqual(["linear:readTask:DOT-109"]);
        const after = await stored();
        expect(after.state).toBe("aborted");
        expect(after.taken).toEqual({ added: null, removed: null });
        const read = await fakes.linear.readTask("DOT-109");
        expect(read.ok && read.value.labels).toEqual(["taken", "grill-me"]);
    });

    it("aborts with nothing to report when taken was never added and the task lacks it", async () => {
        await given(pending({ taken: { added: null, removed: null } }));
        const calls: string[] = [];
        const sessions = fakeSessions({ calls });
        const result = await reconcileStep.run(
            context({ sessions, trackers: linear(calls, ["grill-me"]) }),
        );
        expect(result.data.attempts[0]).toMatchObject({
            state: "aborted",
            action: "aborted",
            detail: null,
        });
        expect(calls).toEqual(["linear:readTask:DOT-109"]);
        expect((await stored()).taken).toEqual({ added: null, removed: null });
    });

    it("still aborts when the task cannot be read to check a taken it never added", async () => {
        await given(pending({ taken: { added: null, removed: null } }));
        const calls: string[] = [];
        const fakes = trackers(
            calls,
            { linear: [task("linear", "DOT-109", ["taken"])] },
            { linear: { readErrors: { "DOT-109": "linear issue view DOT-109: network down" } } },
        );
        const result = await reconcileStep.run(
            context({ sessions: fakeSessions({ calls }), trackers: fakes }),
        );
        expect(result.outcome).toBe("advance");
        expect(result.data.attempts[0]).toMatchObject({
            state: "aborted",
            action: "aborted",
            detail: "could not check taken: linear issue view DOT-109: network down",
        });
        expect(calls).toEqual(["linear:readTask:DOT-109"]);
        expect((await stored()).taken).toEqual({ added: null, removed: null });
    });

    it("aborts without asking the manager when the record holds no session", async () => {
        await given(pending({ session: null }));
        const calls: string[] = [];
        const sessions = fakeSessions({ calls });
        const result = await reconcileStep.run(context({ sessions, trackers: linear(calls) }));
        expect(result.data.attempts[0]?.action).toBe("aborted");
        expect(calls).toEqual([
            "linear:readTask:DOT-109",
            "linear:removeLabel:DOT-109:taken",
            "linear:readTask:DOT-109",
        ]);
    });

    it("stays pending and is not evaluable when taken cannot be removed", async () => {
        await given(pending());
        const calls: string[] = [];
        const sessions = fakeSessions({ calls, findByPath: () => ok([]) });
        const result = await reconcileStep.run(
            context({ sessions, trackers: failingRemoval(calls) }),
        );
        expect(result.outcome).toBe("not-evaluable");
        expect(result.reasons).toEqual([
            `${ID}: linear issue update DOT-109 --remove-label taken: network down`,
        ]);
        expect((await stored()).state).toBe("pending");
    });

    it("retains a recovery with two sessions of the recorded title, touching neither", async () => {
        await given(pending());
        const sessions = fakeSessions({
            findByPath: () =>
                ok([listed("aaaa"), listed("manual0000000000", "mine"), listed("bbbb")]),
        });
        const result = await reconcileStep.run(context({ sessions, trackers: linear([]) }));
        const reason = `2 sessions share ${PATH}: aaaa, bbbb`;
        expect(result.data.attempts[0]).toMatchObject({
            state: "retained",
            action: "ambiguous",
            detail: reason,
        });
        expect(sessions.calls).toEqual([`findByPath ${PATH}`]);
        expect((await stored()).retained).toEqual({ at: AT, reason });
    });

    it("starts a created attempt", async () => {
        await given(record({ state: "created", history: record().history.slice(0, 2) }));
        const sessions = fakeSessions({ start: () => ok(undefined) });
        const result = await reconcileStep.run(context({ sessions, trackers: linear([]) }));
        expect(result.data.attempts[0]).toMatchObject({
            before: "created",
            state: "started",
            action: "started",
        });
        expect(sessions.calls).toEqual([`start ${SESSION}`]);
        expect((await stored()).history.at(-1)).toEqual({ state: "started", at: AT });
    });
});

describe("reconcile: manual sessions are untouched", () => {
    it("runs no session command for a completed attempt sharing its path with a manual session", async () => {
        await given(record({ state: "completed", taken: { added: AT, removed: AT } }));
        const sessions = fakeSessions({
            findByPath: () => ok([listed("manual0000000000", "my own session")]),
        });
        const result = await reconcileStep.run(context({ sessions, trackers: linear([]) }));
        expect(result.data.attempts[0]?.action).toBe("none");
        expect(sessions.calls).toEqual([]);
    });
});

describe("reconcile: the report", () => {
    it("names the attempt, waiting, needs a person and that nothing changed", async () => {
        await given(record());
        const sessions = fakeSessions({ observe: () => ok(seen("waiting")) });
        const result = await reconcileStep.run(context({ sessions, trackers: linear([]) }));
        const text = reconcileStep.render(result);
        expect(text).toBe(
            [
                "[reconcile] advance (code)",
                `  ${ID}  started → started  session waiting/open, needs a person  marker no result marker  observed`,
                "  needs a person:",
                `    ${ID}`,
                "  reasons:",
                "    - 1 attempt observed",
                "    - 1 attempt needs a person",
                "    - nothing changed",
            ].join("\n"),
        );
    });

    it("lists retained attempts and pending cleanups", async () => {
        const second = record({ id: "linear:DOT-109:test:2", attempt: 2, state: "completed" });
        await given(
            record({
                state: "retained",
                retained: { at: AT, reason: "session stopped; no result marker" },
            }),
            { ...second, cleanup: { pending: true, error: "busy" } },
        );
        const result = await reconcileStep.run(
            context({ sessions: fakeSessions({}), trackers: linear([]), apply: false }),
        );
        const text = reconcileStep.render(result);
        expect(text).toContain(
            `  ${ID}  retained → retained  session not observed  marker not checked  none`,
        );
        expect(text).toContain(`  retained:\n    ${ID}`);
        expect(text).toContain(`  cleanups:\n    ${second.id}`);
        expect(text).toContain(`cleanup-pending: busy`);
    });
});
