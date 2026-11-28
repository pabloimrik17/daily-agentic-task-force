import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type TaskKey, taskKey } from "../attempts/record.ts";
import type { Derivation } from "./rules.ts";
import { inertDocumentMethods } from "./test-fixtures.ts";
import type {
    Tracker,
    TrackerLabel,
    TrackerResult,
    TrackerTask,
    Trackers,
} from "./trackers/tracker.ts";
import { applyDerivations, labelCheckFor, missingLabelDetail } from "./write.ts";

interface FakeState {
    labels: string[];
    addLabelResult?: (label: string) => TrackerResult<void>;
    readTaskResult?: () => TrackerResult<TrackerTask>;
    removeLabelResult?: TrackerResult<void>;
    keepsOnRemove?: boolean; // the removal command succeeds and the label stays
}

// `labels` makes the tracker one that creates labels, listing these (or failing with a
// string); without it the tracker is checked like Beads, never listing its labels.
function fakeTracker(
    source: Tracker["source"],
    calls: string[],
    states: Map<string, FakeState>,
    labels?: TrackerLabel[] | string,
): Tracker {
    return {
        source,
        labelScopes: [],
        createsLabels: labels !== undefined,
        listTasks: () => Promise.resolve({ ok: true, value: [] }),
        removeLabel: (id, name) => {
            calls.push(`${source}:removeLabel:${id}:${name}`);
            const state = states.get(id);
            const result = state?.removeLabelResult ?? { ok: true, value: undefined };
            if (result.ok && state !== undefined && state.keepsOnRemove !== true) {
                state.labels = state.labels.filter((label) => label !== name);
            }
            return Promise.resolve(result);
        },
        addLabel: (id, label) => {
            calls.push(`${source}:addLabel:${id}:${label}`);
            const state = states.get(id);
            const result = state?.addLabelResult?.(label) ?? { ok: true, value: undefined };
            if (result.ok && state !== undefined) {
                state.labels = [...state.labels, label];
            }
            return Promise.resolve(result);
        },
        readTask: (id) => {
            calls.push(`${source}:readTask:${id}`);
            const state = states.get(id);
            if (state?.readTaskResult !== undefined) {
                return Promise.resolve(state.readTaskResult());
            }
            return Promise.resolve({
                ok: true,
                value: {
                    source,
                    id,
                    title: "A task",
                    description: null,
                    labels: state?.labels ?? [],
                    status: "open",
                    updatedAt: "",
                    closed: false,
                },
            });
        },
        listLabels: () => {
            calls.push(`${source}:listLabels`);
            return Promise.resolve(
                typeof labels === "string"
                    ? { ok: false, error: labels }
                    : { ok: true, value: labels ?? [] },
            );
        },
        createLabel: () => Promise.reject(new Error("triage never creates a label")),
        recolourLabel: () => Promise.resolve({ ok: false, error: "Beads has no label colours" }),
        ...inertDocumentMethods,
    };
}

function label(scope: string, name: string): TrackerLabel {
    return { scope, name, colour: "#000000" };
}

function task(source: Tracker["source"], id: string, labels: string[]): TrackerTask {
    return {
        source,
        id,
        title: "A task",
        description: null,
        labels,
        status: "open",
        updatedAt: "",
        closed: false,
    };
}

function derivation(overrides: Partial<Derivation> = {}): Derivation {
    return {
        source: "beads",
        taskId: "bd-1",
        title: "A task",
        group: "scope",
        labels: ["work"],
        confidence: 1,
        reason: "alias nazaries",
        tier: "code",
        ...overrides,
    };
}

function trackersOf(beads: Tracker, github: Tracker, linear: Tracker): Trackers {
    return { beads, github, linear };
}

// The read-back waits on the global timer: the fake one lets a test run its waits at once.
beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

describe("applyDerivations", () => {
    it("proposes every eligible derivation and issues no tracker call without --apply", async () => {
        const calls: string[] = [];
        const states = new Map<string, FakeState>([["bd-1", { labels: ["nazaries"] }]]);
        const beads = fakeTracker("beads", calls, states);
        const tasks = new Map([[taskKey("beads", "bd-1"), task("beads", "bd-1", ["nazaries"])]]);
        const { records, failures, missing } = await applyDerivations(
            [derivation()],
            tasks,
            trackersOf(beads, beads, beads),
            false,
        );
        expect(records).toEqual([{ ...derivation(), status: "proposed", detail: null }]);
        expect(failures).toEqual([]);
        expect(missing).toEqual([]);
        expect(calls).toEqual([]);
    });

    it("lists the proposed records in the order --apply would write them", async () => {
        const calls: string[] = [];
        const linear = fakeTracker("linear", calls, new Map(), [
            label("workspace", "personal"),
            label("workspace", "proposal"),
        ]);
        const beads = fakeTracker("beads", calls, new Map());
        const stage = derivation({ source: "linear", group: "stage", labels: ["proposal"] });
        const scope = derivation({ source: "linear", labels: ["personal"] });
        const other = derivation({ taskId: "bd-2" });
        const { records, missing } = await applyDerivations(
            [stage, other, scope],
            new Map(),
            trackersOf(beads, beads, linear),
            false,
        );
        expect(records.map((r) => [r.source, r.taskId, r.group, r.status])).toEqual([
            ["beads", "bd-2", "scope", "proposed"],
            ["linear", "bd-1", "scope", "proposed"],
            ["linear", "bd-1", "stage", "proposed"],
        ]);
        expect(missing).toEqual([]);
        expect(calls).toEqual(["linear:listLabels"]);
    });

    it("adds a label additively, keeping the alias, and reports applied on a matching read-back", async () => {
        const calls: string[] = [];
        const states = new Map<string, FakeState>([["bd-1", { labels: ["nazaries"] }]]);
        const beads = fakeTracker("beads", calls, states);
        const tasks = new Map([[taskKey("beads", "bd-1"), task("beads", "bd-1", ["nazaries"])]]);
        const { records, failures } = await applyDerivations(
            [derivation()],
            tasks,
            trackersOf(beads, beads, beads),
            true,
        );
        expect(records).toEqual([{ ...derivation(), status: "applied", detail: null }]);
        expect(failures).toEqual([]);
        expect(calls).toEqual(["beads:addLabel:bd-1:work", "beads:readTask:bd-1"]);
    });

    it("reads the task again while the tracker lags, and reports applied once the label shows", async () => {
        const calls: string[] = [];
        let stale = 2;
        const states = new Map<string, FakeState>([
            [
                "bd-1",
                {
                    labels: ["nazaries"],
                    readTaskResult: () => ({
                        ok: true,
                        value: task(
                            "beads",
                            "bd-1",
                            stale-- > 0 ? ["nazaries"] : ["nazaries", "work"],
                        ),
                    }),
                },
            ],
        ]);
        const beads = fakeTracker("beads", calls, states);
        const tasks = new Map([[taskKey("beads", "bd-1"), task("beads", "bd-1", ["nazaries"])]]);
        const pending = applyDerivations(
            [derivation()],
            tasks,
            trackersOf(beads, beads, beads),
            true,
        );
        await vi.runAllTimersAsync();
        const { records, failures } = await pending;
        expect(records).toEqual([{ ...derivation(), status: "applied", detail: null }]);
        expect(failures).toEqual([]);
        expect(calls).toEqual([
            "beads:addLabel:bd-1:work",
            "beads:readTask:bd-1",
            "beads:readTask:bd-1",
            "beads:readTask:bd-1",
        ]);
    });

    it("does not read again after a read-back that fails", async () => {
        const calls: string[] = [];
        const states = new Map<string, FakeState>([
            [
                "bd-1",
                {
                    labels: [],
                    readTaskResult: () => ({ ok: false, error: "bd show: bd failed: gone" }),
                },
            ],
        ]);
        const beads = fakeTracker("beads", calls, states);
        const tasks = new Map([[taskKey("beads", "bd-1"), task("beads", "bd-1", [])]]);
        const { records, failures } = await applyDerivations(
            [derivation()],
            tasks,
            trackersOf(beads, beads, beads),
            true,
        );
        expect(records).toEqual([
            { ...derivation(), status: "failed", detail: "bd show: bd failed: gone" },
        ]);
        expect(failures).toMatchObject([{ after: null, error: "bd show: bd failed: gone" }]);
        expect(calls).toEqual(["beads:addLabel:bd-1:work", "beads:readTask:bd-1"]);
    });

    it("writes each task's derivations scope, autonomy, stage, tasks in first-appearance order", async () => {
        const calls: string[] = [];
        const states = new Map<string, FakeState>([
            ["bd-1", { labels: [] }],
            ["bd-2", { labels: [] }],
        ]);
        const beads = fakeTracker("beads", calls, states);
        const tasks = new Map([
            [taskKey("beads", "bd-1"), task("beads", "bd-1", [])],
            [taskKey("beads", "bd-2"), task("beads", "bd-2", [])],
        ]);
        const { records } = await applyDerivations(
            [
                derivation({ group: "stage", labels: ["proposal"] }),
                derivation({ taskId: "bd-2", group: "autonomy", labels: ["AFK"] }),
                derivation({ group: "autonomy", labels: ["HITL"] }),
                derivation({ taskId: "bd-2", group: "scope", labels: ["personal"] }),
                derivation({ group: "scope", labels: ["work"] }),
            ],
            tasks,
            trackersOf(beads, beads, beads),
            true,
        );
        expect(calls.filter((call) => call.includes("addLabel"))).toEqual([
            "beads:addLabel:bd-1:work",
            "beads:addLabel:bd-1:HITL",
            "beads:addLabel:bd-1:proposal",
            "beads:addLabel:bd-2:personal",
            "beads:addLabel:bd-2:AFK",
        ]);
        expect(records.map((r) => [r.taskId, r.group, r.status])).toEqual([
            ["bd-1", "scope", "applied"],
            ["bd-1", "autonomy", "applied"],
            ["bd-1", "stage", "applied"],
            ["bd-2", "scope", "applied"],
            ["bd-2", "autonomy", "applied"],
        ]);
    });

    it("reads the task back after a partial write and reports the labels that landed", async () => {
        const calls: string[] = [];
        const states = new Map<string, FakeState>([
            [
                "bd-1",
                {
                    labels: ["nazaries"],
                    addLabelResult: (label) =>
                        label === "AFK"
                            ? { ok: false, error: "bd label add: bd failed: boom" }
                            : { ok: true, value: undefined },
                },
            ],
        ]);
        const beads = fakeTracker("beads", calls, states);
        const tasks = new Map([[taskKey("beads", "bd-1"), task("beads", "bd-1", ["nazaries"])]]);
        // No derivation the triage makes carries two labels; the write still handles one.
        const autonomy = derivation({ group: "autonomy", labels: ["grill-me", "AFK"] });
        const { records, failures } = await applyDerivations(
            [autonomy],
            tasks,
            trackersOf(beads, beads, beads),
            true,
        );
        expect(records).toEqual([
            { ...autonomy, status: "failed", detail: "bd label add: bd failed: boom" },
        ]);
        expect(failures).toEqual([
            {
                source: "beads",
                taskId: "bd-1",
                labels: ["grill-me", "AFK"],
                before: ["nazaries"],
                after: ["nazaries", "grill-me"],
                error: "bd label add: bd failed: boom",
            },
        ]);
        expect(calls).toEqual([
            "beads:addLabel:bd-1:grill-me",
            "beads:addLabel:bd-1:AFK",
            "beads:readTask:bd-1",
        ]);
    });

    it("keeps a null after when the read-back of a partial write fails too", async () => {
        const calls: string[] = [];
        const states = new Map<string, FakeState>([
            [
                "bd-1",
                {
                    labels: [],
                    addLabelResult: (label) =>
                        label === "AFK"
                            ? { ok: false, error: "bd label add: bd failed: boom" }
                            : { ok: true, value: undefined },
                    readTaskResult: () => ({ ok: false, error: "bd show: bd failed: gone" }),
                },
            ],
        ]);
        const beads = fakeTracker("beads", calls, states);
        const tasks = new Map([[taskKey("beads", "bd-1"), task("beads", "bd-1", [])]]);
        const { failures } = await applyDerivations(
            [derivation({ group: "autonomy", labels: ["grill-me", "AFK"] })],
            tasks,
            trackersOf(beads, beads, beads),
            true,
        );
        expect(failures).toEqual([
            {
                source: "beads",
                taskId: "bd-1",
                labels: ["grill-me", "AFK"],
                before: [],
                after: null,
                error: "bd label add: bd failed: boom",
            },
        ]);
    });

    it("expects the labels an earlier derivation added to the same task in the read-back", async () => {
        const calls: string[] = [];
        const reads = [
            task("beads", "bd-1", ["nazaries", "work"]),
            task("beads", "bd-1", ["nazaries", "AFK"]),
        ];
        const states = new Map<string, FakeState>([
            [
                "bd-1",
                {
                    labels: ["nazaries"],
                    readTaskResult: () => ({
                        ok: true,
                        value: reads.length > 1 ? reads.shift()! : reads[0]!,
                    }),
                },
            ],
        ]);
        const beads = fakeTracker("beads", calls, states);
        const tasks = new Map([[taskKey("beads", "bd-1"), task("beads", "bd-1", ["nazaries"])]]);
        const scope = derivation();
        const autonomy = derivation({ group: "autonomy", labels: ["AFK"] });
        const pending = applyDerivations(
            [scope, autonomy],
            tasks,
            trackersOf(beads, beads, beads),
            true,
        );
        await vi.runAllTimersAsync();
        const { records, failures } = await pending;
        const error =
            "read-back mismatch: before [nazaries, work] + [AFK] → after [nazaries, AFK] (read 6 times over 30 s)";
        expect(records).toEqual([
            { ...scope, status: "applied", detail: null },
            { ...autonomy, status: "failed", detail: error },
        ]);
        expect(failures).toEqual([
            {
                source: "beads",
                taskId: "bd-1",
                labels: ["AFK"],
                before: ["nazaries", "work"],
                after: ["nazaries", "AFK"],
                error,
            },
        ]);
    });

    it("reports a mismatch with both label sets, skips the next derivation of that source, and lets other sources write", async () => {
        const calls: string[] = [];
        const states = new Map<string, FakeState>([
            [
                "lin-1",
                {
                    labels: ["work"],
                    readTaskResult: () => ({
                        ok: true,
                        value: task("linear", "lin-1", ["work"]),
                    }),
                },
            ],
            ["bd-1", { labels: ["nazaries"] }],
        ]);
        const linear = fakeTracker("linear", calls, states);
        const beads = fakeTracker("beads", calls, states);
        const tasks = new Map([
            [taskKey("linear", "lin-1"), task("linear", "lin-1", ["work"])],
            [taskKey("beads", "bd-1"), task("beads", "bd-1", ["nazaries"])],
        ]);
        const first = derivation({
            source: "linear",
            taskId: "lin-1",
            group: "scope",
            labels: ["personal"],
        });
        const second = derivation({
            source: "linear",
            taskId: "lin-1",
            group: "autonomy",
            labels: ["AFK"],
        });
        const other = derivation({ source: "beads" });
        const pending = applyDerivations(
            [first, second, other],
            tasks,
            trackersOf(beads, beads, linear),
            true,
        );
        await vi.runAllTimersAsync();
        const { records, failures } = await pending;
        const error =
            "read-back mismatch: before [work] + [personal] → after [work] (read 6 times over 30 s)";
        expect(records).toEqual([
            { ...other, status: "applied", detail: null },
            {
                ...first,
                status: "failed",
                detail: error,
            },
            { ...second, status: "proposed", detail: "skipped after a write failure on linear" },
        ]);
        expect(failures).toEqual([
            {
                source: "linear",
                taskId: "lin-1",
                labels: ["personal"],
                before: ["work"],
                after: ["work"],
                error,
            },
        ]);
        expect(calls).toEqual([
            "beads:addLabel:bd-1:work",
            "beads:readTask:bd-1",
            "linear:addLabel:lin-1:personal",
            ...Array<string>(6).fill("linear:readTask:lin-1"),
        ]);
    });

    it("stops the source on an addLabel CLI error, recording it as failed with no read-back", async () => {
        const calls: string[] = [];
        const states = new Map<string, FakeState>([
            [
                "bd-1",
                {
                    labels: [],
                    addLabelResult: () => ({
                        ok: false,
                        error: "bd label add: bd CLI not found on PATH",
                    }),
                },
            ],
        ]);
        const beads = fakeTracker("beads", calls, states);
        const tasks = new Map([[taskKey("beads", "bd-1"), task("beads", "bd-1", [])]]);
        const { records, failures } = await applyDerivations(
            [derivation()],
            tasks,
            trackersOf(beads, beads, beads),
            true,
        );
        expect(records).toEqual([
            { ...derivation(), status: "failed", detail: "bd label add: bd CLI not found on PATH" },
        ]);
        expect(failures).toEqual([
            {
                source: "beads",
                taskId: "bd-1",
                labels: ["work"],
                before: [],
                after: null,
                error: "bd label add: bd CLI not found on PATH",
            },
        ]);
        expect(calls).toEqual(["beads:addLabel:bd-1:work"]);
    });

    it("reports a readTask error with a null after and no further beads write", async () => {
        const calls: string[] = [];
        const states = new Map<string, FakeState>([
            [
                "bd-1",
                {
                    labels: [],
                    readTaskResult: () => ({
                        ok: false,
                        error: "bd show: bd CLI not found on PATH",
                    }),
                },
            ],
        ]);
        const beads = fakeTracker("beads", calls, states);
        const tasks = new Map([[taskKey("beads", "bd-1"), task("beads", "bd-1", [])]]);
        const { failures } = await applyDerivations(
            [derivation()],
            tasks,
            trackersOf(beads, beads, beads),
            true,
        );
        expect(failures).toEqual([
            {
                source: "beads",
                taskId: "bd-1",
                labels: ["work"],
                before: [],
                after: null,
                error: "bd show: bd CLI not found on PATH",
            },
        ]);
    });

    it("does not mutate the input tasks map or its task labels", async () => {
        const calls: string[] = [];
        const states = new Map<string, FakeState>([["bd-1", { labels: ["nazaries"] }]]);
        const beads = fakeTracker("beads", calls, states);
        const before = task("beads", "bd-1", ["nazaries"]);
        const tasks = new Map([[taskKey("beads", "bd-1"), before]]);
        await applyDerivations([derivation()], tasks, trackersOf(beads, beads, beads), true);
        expect(tasks.get(taskKey("beads", "bd-1"))).toBe(before);
        expect(before.labels).toEqual(["nazaries"]);
    });
});

describe("applyDerivations: labels missing on a tracker", () => {
    it("proposal not bootstrapped on Linear: proposed with the bootstrap hint, the other Linear writes applied", async () => {
        const calls: string[] = [];
        const states = new Map<string, FakeState>([
            ["DOT-1", { labels: ["personal"] }],
            ["DOT-2", { labels: [] }],
        ]);
        const linear = fakeTracker("linear", calls, states, [
            label("workspace", "personal"),
            label("DOT", "HITL"),
        ]);
        const beads = fakeTracker("beads", calls, new Map());
        const tasks = new Map([
            [taskKey("linear", "DOT-1"), task("linear", "DOT-1", ["personal"])],
            [taskKey("linear", "DOT-2"), task("linear", "DOT-2", [])],
        ]);
        const hitl = derivation({
            source: "linear",
            taskId: "DOT-1",
            group: "autonomy",
            labels: ["HITL"],
        });
        const proposal = derivation({
            source: "linear",
            taskId: "DOT-1",
            group: "stage",
            labels: ["proposal"],
            reason: "follows autonomy HITL",
        });
        const scope = derivation({ source: "linear", taskId: "DOT-2", labels: ["personal"] });
        const { records, failures, missing } = await applyDerivations(
            [hitl, proposal, scope],
            tasks,
            trackersOf(beads, beads, linear),
            true,
        );
        const detail = "proposal is missing on linear; run --bootstrap-labels";
        expect(records).toEqual([
            { ...hitl, status: "applied", detail: null },
            { ...proposal, status: "proposed", detail },
            { ...scope, status: "applied", detail: null },
        ]);
        expect(failures).toEqual([]);
        expect(missing).toEqual([detail]);
        expect(calls).toEqual([
            "linear:listLabels",
            "linear:addLabel:DOT-1:HITL",
            "linear:readTask:DOT-1",
            "linear:addLabel:DOT-2:personal",
            "linear:readTask:DOT-2",
        ]);
    });

    it("names each missing label once, however many derivations it skips", async () => {
        const calls: string[] = [];
        const linear = fakeTracker("linear", calls, new Map(), [label("DOT", "AFK")]);
        const proposalFor = (taskId: string) =>
            derivation({ source: "linear", taskId, group: "stage", labels: ["proposal"] });
        const { records, missing } = await applyDerivations(
            [proposalFor("DOT-1"), proposalFor("DOT-2")],
            new Map(),
            trackersOf(linear, linear, linear),
            true,
        );
        expect(records.map((r) => r.status)).toEqual(["proposed", "proposed"]);
        expect(missing).toEqual(["proposal is missing on linear; run --bootstrap-labels"]);
        expect(calls).toEqual(["linear:listLabels"]);
    });

    it("counts a GitHub label present only in another repository as missing", async () => {
        const calls: string[] = [];
        const states = new Map<string, FakeState>([["owner/repo#1", { labels: [] }]]);
        const github = fakeTracker("github", calls, states, [
            label("owner/other", "AFK"),
            label("owner/repo", "work"),
        ]);
        const afk = derivation({
            source: "github",
            taskId: "owner/repo#1",
            group: "autonomy",
            labels: ["AFK"],
        });
        const work = derivation({ source: "github", taskId: "owner/repo#1", labels: ["work"] });
        const { records, missing } = await applyDerivations(
            [afk, work],
            new Map(),
            trackersOf(github, github, github),
            true,
        );
        expect(records.map((r) => [r.group, r.status, r.detail])).toEqual([
            ["scope", "applied", null],
            ["autonomy", "proposed", "AFK is missing on github; run --bootstrap-labels"],
        ]);
        expect(missing).toEqual(["AFK is missing on github; run --bootstrap-labels"]);
    });

    it("finds a GitHub label in the task's repository typed in another letter case", async () => {
        const calls: string[] = [];
        const states = new Map<string, FakeState>([["Owner/Repo#7", { labels: [] }]]);
        const github = fakeTracker("github", calls, states, [label("owner/repo", "work")]);
        const work = derivation({ source: "github", taskId: "Owner/Repo#7", labels: ["work"] });
        const { records, missing } = await applyDerivations(
            [work],
            new Map(),
            trackersOf(github, github, github),
            true,
        );
        expect(records.map((r) => [r.status, r.detail])).toEqual([["applied", null]]);
        expect(missing).toEqual([]);
        expect(states.get("Owner/Repo#7")?.labels).toEqual(["work"]);
    });

    it("Beads: writes proposal without listing its labels", async () => {
        const calls: string[] = [];
        const states = new Map<string, FakeState>([["bd-1", { labels: ["work", "AFK"] }]]);
        const beads = fakeTracker("beads", calls, states);
        const tasks = new Map([[taskKey("beads", "bd-1"), task("beads", "bd-1", ["work", "AFK"])]]);
        const proposal = derivation({ group: "stage", labels: ["proposal"] });
        const { records, missing } = await applyDerivations(
            [proposal],
            tasks,
            trackersOf(beads, beads, beads),
            true,
        );
        expect(records).toEqual([{ ...proposal, status: "applied", detail: null }]);
        expect(missing).toEqual([]);
        expect(calls).toEqual(["beads:addLabel:bd-1:proposal", "beads:readTask:bd-1"]);
    });

    it("leaves a skipped derivation proposed, never attempted, so selection does not count it as labelled", async () => {
        const calls: string[] = [];
        const linear = fakeTracker("linear", calls, new Map(), []);
        const proposal = derivation({
            source: "linear",
            taskId: "DOT-1",
            group: "stage",
            labels: ["proposal"],
        });
        const { records, failures } = await applyDerivations(
            [proposal],
            new Map(),
            trackersOf(linear, linear, linear),
            true,
        );
        // Selection excludes a task as labelled this run only on an applied or failed record.
        expect(records.map((r) => r.status)).toEqual(["proposed"]);
        expect(failures).toEqual([]);
        expect(calls.filter((call) => call.includes("addLabel"))).toEqual([]);
    });

    it("stops the source like a write error when listing its labels fails, and lets other sources write", async () => {
        const calls: string[] = [];
        const error = "linear label list --all --json: Linear CLI is not authenticated";
        const states = new Map<string, FakeState>([["bd-1", { labels: [] }]]);
        const linear = fakeTracker("linear", calls, new Map(), error);
        const beads = fakeTracker("beads", calls, states);
        const tasks = new Map([[taskKey("linear", "DOT-1"), task("linear", "DOT-1", ["bug"])]]);
        const first = derivation({ source: "linear", taskId: "DOT-1", labels: ["personal"] });
        const second = derivation({
            source: "linear",
            taskId: "DOT-2",
            group: "autonomy",
            labels: ["AFK"],
        });
        const other = derivation();
        const { records, failures, missing } = await applyDerivations(
            [first, second, other],
            tasks,
            trackersOf(beads, beads, linear),
            true,
        );
        expect(records).toEqual([
            { ...other, status: "applied", detail: null },
            { ...first, status: "failed", detail: error },
            { ...second, status: "proposed", detail: "skipped after a write failure on linear" },
        ]);
        expect(failures).toEqual([
            {
                source: "linear",
                taskId: "DOT-1",
                labels: ["personal"],
                before: ["bug"],
                after: null,
                error,
            },
        ]);
        expect(missing).toEqual([]);
        expect(calls).toEqual([
            "beads:addLabel:bd-1:work",
            "beads:readTask:bd-1",
            "linear:listLabels",
        ]);
    });

    it("lists no labels for a source with nothing to write", async () => {
        const calls: string[] = [];
        const linear = fakeTracker("linear", calls, new Map(), "must not be listed");
        const beads = fakeTracker("beads", calls, new Map([["bd-1", { labels: [] }]]));
        await applyDerivations([derivation()], new Map(), trackersOf(beads, linear, linear), true);
        expect(calls).toEqual(["beads:addLabel:bd-1:work", "beads:readTask:bd-1"]);
    });
});

describe("applyDerivations: the label check without --apply", () => {
    it("Dry run reports a missing label: proposed with the bootstrap hint, nothing written", async () => {
        const calls: string[] = [];
        const states = new Map<string, FakeState>([
            ["DOT-1", { labels: ["personal"] }],
            ["DOT-2", { labels: [] }],
        ]);
        const linear = fakeTracker("linear", calls, states, [
            label("workspace", "personal"),
            label("DOT", "HITL"),
        ]);
        const beads = fakeTracker("beads", calls, new Map());
        const hitl = derivation({
            source: "linear",
            taskId: "DOT-1",
            group: "autonomy",
            labels: ["HITL"],
        });
        const proposal = derivation({
            source: "linear",
            taskId: "DOT-1",
            group: "stage",
            labels: ["proposal"],
            reason: "follows autonomy HITL",
        });
        const scope = derivation({ source: "linear", taskId: "DOT-2", labels: ["personal"] });
        const { records, failures, missing } = await applyDerivations(
            [hitl, proposal, scope],
            new Map(),
            trackersOf(beads, beads, linear),
            false,
        );
        const detail = "proposal is missing on linear; run --bootstrap-labels";
        expect(records).toEqual([
            { ...hitl, status: "proposed", detail: null },
            { ...proposal, status: "proposed", detail },
            { ...scope, status: "proposed", detail: null },
        ]);
        expect(failures).toEqual([]);
        expect(missing).toEqual([detail]);
        expect(calls).toEqual(["linear:listLabels"]);
    });

    it("names each missing label once, however many derivations it skips", async () => {
        const calls: string[] = [];
        const linear = fakeTracker("linear", calls, new Map(), []);
        const first = derivation({
            source: "linear",
            taskId: "DOT-1",
            group: "stage",
            labels: ["proposal"],
        });
        const second = { ...first, taskId: "DOT-2" };
        const { records, missing } = await applyDerivations(
            [first, second],
            new Map(),
            trackersOf(linear, linear, linear),
            false,
        );
        const detail = "proposal is missing on linear; run --bootstrap-labels";
        expect(records.map((r) => r.detail)).toEqual([detail, detail]);
        expect(missing).toEqual([detail]);
    });

    it("counts a GitHub label present only in another repository as missing", async () => {
        const calls: string[] = [];
        const github = fakeTracker("github", calls, new Map(), [
            label("owner/other", "proposal"),
            label("owner/repo", "work"),
        ]);
        const proposal = derivation({
            source: "github",
            taskId: "owner/repo#1",
            group: "stage",
            labels: ["proposal"],
        });
        const scope = derivation({ source: "github", taskId: "owner/repo#1", labels: ["work"] });
        const { records } = await applyDerivations(
            [scope, proposal],
            new Map(),
            trackersOf(github, github, github),
            false,
        );
        expect(records.map((r) => [r.labels, r.status, r.detail])).toEqual([
            [["work"], "proposed", null],
            [["proposal"], "proposed", "proposal is missing on github; run --bootstrap-labels"],
        ]);
    });

    it("Dry run on Beads lists no labels", async () => {
        const calls: string[] = [];
        const beads = fakeTracker("beads", calls, new Map());
        const proposal = derivation({ group: "stage", labels: ["proposal"] });
        const { records, missing } = await applyDerivations(
            [proposal],
            new Map(),
            trackersOf(beads, beads, beads),
            false,
        );
        expect(records).toEqual([{ ...proposal, status: "proposed", detail: null }]);
        expect(missing).toEqual([]);
        expect(calls).toEqual([]);
    });

    it("Dry run with a failing listing: records proposed, fails nothing, adds one note", async () => {
        const calls: string[] = [];
        const error = "linear label list --all --json: Linear CLI is not authenticated";
        const linear = fakeTracker("linear", calls, new Map(), error);
        const first = derivation({ source: "linear", taskId: "DOT-1", labels: ["personal"] });
        const second = derivation({
            source: "linear",
            taskId: "DOT-2",
            group: "autonomy",
            labels: ["AFK"],
        });
        const { records, failures, missing } = await applyDerivations(
            [first, second],
            new Map(),
            trackersOf(linear, linear, linear),
            false,
        );
        expect(records).toEqual([
            { ...first, status: "proposed", detail: null },
            { ...second, status: "proposed", detail: null },
        ]);
        expect(failures).toEqual([]);
        expect(missing).toEqual([`labels on linear could not be listed: ${error}`]);
        expect(calls).toEqual(["linear:listLabels"]);
    });

    it("Dry run calls listLabels once per source with something to write", async () => {
        const calls: string[] = [];
        const linear = fakeTracker("linear", calls, new Map(), [label("workspace", "personal")]);
        const github = fakeTracker("github", calls, new Map(), "must not be listed");
        const beads = fakeTracker("beads", calls, new Map());
        const first = derivation({ source: "linear", taskId: "DOT-1", labels: ["personal"] });
        const second = { ...first, taskId: "DOT-2" };
        const { records, missing } = await applyDerivations(
            [first, second],
            new Map(),
            trackersOf(beads, github, linear),
            false,
        );
        expect(records.map((r) => r.status)).toEqual(["proposed", "proposed"]);
        expect(missing).toEqual([]);
        expect(calls).toEqual(["linear:listLabels"]);
    });
});

describe("missingLabelDetail", () => {
    it("names the label, the source and the bootstrap flag", () => {
        expect(missingLabelDetail("proposal", "linear")).toBe(
            "proposal is missing on linear; run --bootstrap-labels",
        );
    });
});

describe("labelCheckFor", () => {
    it("finds a Linear label in any scope, workspace or team", async () => {
        const linear = fakeTracker("linear", [], new Map(), [
            label("workspace", "work"),
            label("DOT", "HITL"),
        ]);
        const check = await labelCheckFor(linear);
        expect(
            check.ok && ["work", "HITL", "proposal"].map((name) => check.value(name, "X-1")),
        ).toEqual([true, true, false]);
    });

    it("finds a GitHub label only in the task's repository", async () => {
        const github = fakeTracker("github", [], new Map(), [label("owner/repo", "AFK")]);
        const check = await labelCheckFor(github);
        expect(
            check.ok && [check.value("AFK", "owner/repo#3"), check.value("AFK", "owner/other#3")],
        ).toEqual([true, false]);
    });

    it("is always true for a tracker that creates no labels, listing nothing", async () => {
        const calls: string[] = [];
        const check = await labelCheckFor(fakeTracker("beads", calls, new Map()));
        expect(check.ok && check.value("proposal", "bd-1")).toBe(true);
        expect(calls).toEqual([]);
    });

    it("returns the listing's error", async () => {
        const check = await labelCheckFor(
            fakeTracker("github", [], new Map(), "gh label list: boom"),
        );
        expect(check).toEqual({ ok: false, error: "gh label list: boom" });
    });
});

function tasksOf(...given: TrackerTask[]): Map<TaskKey, TrackerTask> {
    return new Map(given.map((one) => [taskKey(one.source, one.id), one]));
}

// Fakes that hold the listed tasks, so addLabel and removeLabel act on what readTask returns.
function statesOf(...given: TrackerTask[]): Map<string, FakeState> {
    return new Map(given.map((one) => [one.id, { labels: [...one.labels] }]));
}

function marks(...given: TrackerTask[]): Set<TaskKey> {
    return new Set(given.map((one) => taskKey(one.source, one.id)));
}

describe("applyDerivations: Mark the tasks left for the human", () => {
    it("Doubt in a run with apply: triage-me is added to the Beads task and its other labels remain", async () => {
        const calls: string[] = [];
        const doubt = task("beads", "bd-1", ["personal"]);
        const states = statesOf(doubt);
        const beads = fakeTracker("beads", calls, states);
        const written = await applyDerivations(
            [],
            tasksOf(doubt),
            trackersOf(beads, beads, beads),
            true,
            marks(doubt),
        );
        expect(written.marked).toEqual([
            { source: "beads", taskId: "bd-1", status: "applied", detail: null },
        ]);
        expect(written.unmarked).toEqual([]);
        expect(written.failures).toEqual([]);
        expect(states.get("bd-1")?.labels).toEqual(["personal", "triage-me"]);
        expect(calls).toEqual(["beads:addLabel:bd-1:triage-me", "beads:readTask:bd-1"]);
    });

    it("Doubt in an iteration of the loop: triage-me is added to the GitHub task, checked in its repository", async () => {
        const calls: string[] = [];
        const doubt = task("github", "owner/repo#3", ["AFK"]);
        const states = statesOf(doubt);
        const github = fakeTracker("github", calls, states, [label("owner/repo", "triage-me")]);
        const beads = fakeTracker("beads", calls, new Map());
        const written = await applyDerivations(
            [],
            tasksOf(doubt),
            trackersOf(beads, github, beads),
            true,
            marks(doubt),
        );
        expect(written.marked).toEqual([
            { source: "github", taskId: "owner/repo#3", status: "applied", detail: null },
        ]);
        expect(states.get("owner/repo#3")?.labels).toEqual(["AFK", "triage-me"]);
        expect(calls).toEqual([
            "github:listLabels",
            "github:addLabel:owner/repo#3:triage-me",
            "github:readTask:owner/repo#3",
        ]);
    });

    it("Run without apply: the mark is reported as proposed and no write is issued", async () => {
        const calls: string[] = [];
        const doubt = task("beads", "bd-1", ["work"]);
        const beads = fakeTracker("beads", calls, statesOf(doubt));
        const written = await applyDerivations(
            [],
            tasksOf(doubt),
            trackersOf(beads, beads, beads),
            false,
            marks(doubt),
        );
        expect(written.marked).toEqual([
            { source: "beads", taskId: "bd-1", status: "proposed", detail: null },
        ]);
        expect(calls).toEqual([]);
    });

    it("One group written, one in doubt: the task gains work, then triage-me", async () => {
        const calls: string[] = [];
        const doubt = task("beads", "bd-1", ["nazaries"]);
        const states = statesOf(doubt);
        const beads = fakeTracker("beads", calls, states);
        const written = await applyDerivations(
            [derivation()],
            tasksOf(doubt),
            trackersOf(beads, beads, beads),
            true,
            marks(doubt),
        );
        expect(written.records).toEqual([{ ...derivation(), status: "applied", detail: null }]);
        expect(written.marked).toEqual([
            { source: "beads", taskId: "bd-1", status: "applied", detail: null },
        ]);
        expect(states.get("bd-1")?.labels).toEqual(["nazaries", "work", "triage-me"]);
        expect(calls).toEqual([
            "beads:addLabel:bd-1:work",
            "beads:readTask:bd-1",
            "beads:addLabel:bd-1:triage-me",
            "beads:readTask:bd-1",
        ]);
    });

    it("skips a task to mark that already carries triage-me", async () => {
        const calls: string[] = [];
        const marked = task("beads", "bd-1", ["work", "triage-me"]);
        const beads = fakeTracker("beads", calls, statesOf(marked));
        const written = await applyDerivations(
            [],
            tasksOf(marked),
            trackersOf(beads, beads, beads),
            true,
            marks(marked),
        );
        expect(written.marked).toEqual([]);
        expect(written.unmarked).toEqual([]);
        expect(calls).toEqual([]);
    });

    it("fails a mark whose read-back lacks it, as a write failure that stops the source", async () => {
        const calls: string[] = [];
        const first = task("linear", "DOT-1", ["work"]);
        const second = task("linear", "DOT-2", ["personal"]);
        const complete = task("linear", "DOT-3", ["work", "AFK", "proposal", "triage-me"]);
        const states = statesOf(first, second, complete);
        states.set("DOT-1", {
            labels: ["work"],
            readTaskResult: () => ({ ok: true, value: task("linear", "DOT-1", ["work"]) }),
        });
        const linear = fakeTracker("linear", calls, states, [label("workspace", "triage-me")]);
        const beads = fakeTracker("beads", calls, new Map());
        const pending = applyDerivations(
            [],
            tasksOf(first, second, complete),
            trackersOf(beads, beads, linear),
            true,
            marks(first, second),
        );
        await vi.runAllTimersAsync();
        const written = await pending;
        const error =
            "read-back mismatch: before [work] + [triage-me] → after [work] (read 6 times over 30 s)";
        const skipped = "skipped after a write failure on linear";
        expect(written.marked).toEqual([
            { source: "linear", taskId: "DOT-1", status: "failed", detail: error },
            { source: "linear", taskId: "DOT-2", status: "proposed", detail: skipped },
        ]);
        expect(written.unmarked).toEqual([
            { source: "linear", taskId: "DOT-3", status: "proposed", detail: skipped },
        ]);
        expect(written.failures).toEqual([
            {
                source: "linear",
                taskId: "DOT-1",
                labels: ["triage-me"],
                before: ["work"],
                after: ["work"],
                error,
            },
        ]);
        expect(calls.filter((call) => !call.includes("readTask"))).toEqual([
            "linear:listLabels",
            "linear:addLabel:DOT-1:triage-me",
        ]);
    });

    it("fails a mark on an addLabel error with no read-back, and lets other sources mark", async () => {
        const calls: string[] = [];
        const error = "gh issue edit: gh CLI not found on PATH";
        const failing = task("github", "owner/repo#1", []);
        const states = statesOf(failing);
        states.set("owner/repo#1", { labels: [], addLabelResult: () => ({ ok: false, error }) });
        const github = fakeTracker("github", calls, states, [label("owner/repo", "triage-me")]);
        const doubt = task("linear", "DOT-1", ["work"]);
        const linear = fakeTracker("linear", calls, statesOf(doubt), [
            label("workspace", "triage-me"),
        ]);
        const beads = fakeTracker("beads", calls, new Map());
        const written = await applyDerivations(
            [],
            tasksOf(failing, doubt),
            trackersOf(beads, github, linear),
            true,
            marks(failing, doubt),
        );
        expect(written.marked).toEqual([
            { source: "github", taskId: "owner/repo#1", status: "failed", detail: error },
            { source: "linear", taskId: "DOT-1", status: "applied", detail: null },
        ]);
        expect(written.failures).toEqual([
            {
                source: "github",
                taskId: "owner/repo#1",
                labels: ["triage-me"],
                before: [],
                after: null,
                error,
            },
        ]);
    });

    it("fails the first mark of a source whose labels cannot be listed, stopping it", async () => {
        const calls: string[] = [];
        const error = "linear label list --all --json: Linear CLI is not authenticated";
        const first = task("linear", "DOT-1", []);
        const second = task("linear", "DOT-2", []);
        const linear = fakeTracker("linear", calls, statesOf(first, second), error);
        const beads = fakeTracker("beads", calls, new Map());
        const written = await applyDerivations(
            [],
            tasksOf(first, second),
            trackersOf(beads, beads, linear),
            true,
            marks(first, second),
        );
        expect(written.marked).toEqual([
            { source: "linear", taskId: "DOT-1", status: "failed", detail: error },
            {
                source: "linear",
                taskId: "DOT-2",
                status: "proposed",
                detail: "skipped after a write failure on linear",
            },
        ]);
        expect(written.failures.map((failure) => [failure.taskId, failure.after])).toEqual([
            ["DOT-1", null],
        ]);
        expect(calls).toEqual(["linear:listLabels"]);
    });
});

describe("applyDerivations: Doubts that are not marked", () => {
    it("does not mark a task of a source whose writes stopped, nor issue its write", async () => {
        const calls: string[] = [];
        const error = "bd label add: bd CLI not found on PATH";
        const failing = task("beads", "bd-1", []);
        const doubt = task("beads", "bd-2", ["work"]);
        const states = statesOf(failing, doubt);
        states.set("bd-1", { labels: [], addLabelResult: () => ({ ok: false, error }) });
        const beads = fakeTracker("beads", calls, states);
        const written = await applyDerivations(
            [derivation()],
            tasksOf(failing, doubt),
            trackersOf(beads, beads, beads),
            true,
            marks(failing, doubt),
        );
        const skipped = "skipped after a write failure on beads";
        expect(written.marked).toEqual([
            { source: "beads", taskId: "bd-1", status: "proposed", detail: skipped },
            { source: "beads", taskId: "bd-2", status: "proposed", detail: skipped },
        ]);
        expect(written.failures.map((failure) => failure.labels)).toEqual([["work"]]);
        expect(calls).toEqual(["beads:addLabel:bd-1:work"]);
    });

    it("Label not bootstrapped: the mark is proposed with the bootstrap note, and the other Linear writes happen", async () => {
        const calls: string[] = [];
        const doubt = task("linear", "DOT-1", []);
        const other = task("linear", "DOT-2", []);
        const complete = task("linear", "DOT-3", ["work", "AFK", "proposal", "triage-me"]);
        const states = statesOf(doubt, other, complete);
        const linear = fakeTracker("linear", calls, states, [label("workspace", "personal")]);
        const beads = fakeTracker("beads", calls, new Map());
        const scope = derivation({ source: "linear", taskId: "DOT-1", labels: ["personal"] });
        const written = await applyDerivations(
            [scope],
            tasksOf(doubt, other, complete),
            trackersOf(beads, beads, linear),
            true,
            marks(doubt, other),
        );
        const detail = missingLabelDetail("triage-me", "linear");
        expect(detail).toBe("triage-me is missing on linear; run --bootstrap-labels");
        expect(written.records).toEqual([{ ...scope, status: "applied", detail: null }]);
        expect(written.marked).toEqual([
            { source: "linear", taskId: "DOT-1", status: "proposed", detail },
            { source: "linear", taskId: "DOT-2", status: "proposed", detail },
        ]);
        expect(written.unmarked).toEqual([
            { source: "linear", taskId: "DOT-3", status: "applied", detail: null },
        ]);
        expect(written.missing).toEqual([detail]);
        expect(written.failures).toEqual([]);
        expect(calls.filter((call) => !call.includes("readTask"))).toEqual([
            "linear:listLabels",
            "linear:addLabel:DOT-1:personal",
            "linear:removeLabel:DOT-3:triage-me",
        ]);
    });

    it("Label not bootstrapped in a dry run: the mark is proposed with the bootstrap note", async () => {
        const calls: string[] = [];
        const doubt = task("github", "owner/repo#1", []);
        const github = fakeTracker("github", calls, statesOf(doubt), [
            label("owner/other", "triage-me"),
        ]);
        const beads = fakeTracker("beads", calls, new Map());
        const written = await applyDerivations(
            [],
            tasksOf(doubt),
            trackersOf(beads, github, beads),
            false,
            marks(doubt),
        );
        const detail = missingLabelDetail("triage-me", "github");
        expect(written.marked).toEqual([
            { source: "github", taskId: "owner/repo#1", status: "proposed", detail },
        ]);
        expect(written.missing).toEqual([detail]);
        expect(calls).toEqual(["github:listLabels"]);
    });
});

describe("applyDerivations: Remove the mark from a complete task", () => {
    it("Label added by the person: triage-me is removed and nothing else is removed", async () => {
        const calls: string[] = [];
        const marked = task("beads", "bd-1", ["personal", "HITL", "proposal", "triage-me"]);
        const states = statesOf(marked);
        const beads = fakeTracker("beads", calls, states);
        const written = await applyDerivations(
            [],
            tasksOf(marked),
            trackersOf(beads, beads, beads),
            true,
        );
        expect(written.unmarked).toEqual([
            { source: "beads", taskId: "bd-1", status: "applied", detail: null },
        ]);
        expect(written.marked).toEqual([]);
        expect(states.get("bd-1")?.labels).toEqual(["personal", "HITL", "proposal"]);
        expect(calls).toEqual(["beads:removeLabel:bd-1:triage-me", "beads:readTask:bd-1"]);
    });

    it("Completed by a rule in the same run: proposal is written, then triage-me is removed", async () => {
        const calls: string[] = [];
        const marked = task("beads", "bd-1", ["work", "AFK", "triage-me"]);
        const states = statesOf(marked);
        const beads = fakeTracker("beads", calls, states);
        const proposal = derivation({ group: "stage", labels: ["proposal"] });
        const written = await applyDerivations(
            [proposal],
            tasksOf(marked),
            trackersOf(beads, beads, beads),
            true,
        );
        expect(written.records).toEqual([{ ...proposal, status: "applied", detail: null }]);
        expect(written.unmarked).toEqual([
            { source: "beads", taskId: "bd-1", status: "applied", detail: null },
        ]);
        expect(states.get("bd-1")?.labels).toEqual(["work", "AFK", "proposal"]);
        expect(calls).toEqual([
            "beads:addLabel:bd-1:proposal",
            "beads:readTask:bd-1",
            "beads:removeLabel:bd-1:triage-me",
            "beads:readTask:bd-1",
        ]);
    });

    it("removes triage-me from a task deferred to the grill", async () => {
        const calls: string[] = [];
        const marked = task("beads", "bd-1", ["personal", "grill-me", "triage-me"]);
        const beads = fakeTracker("beads", calls, statesOf(marked));
        const written = await applyDerivations(
            [],
            tasksOf(marked),
            trackersOf(beads, beads, beads),
            true,
        );
        expect(written.unmarked.map((record) => record.status)).toEqual(["applied"]);
    });

    it("Still in doubt: a marked task with work and no autonomy or stage keeps triage-me", async () => {
        const calls: string[] = [];
        const marked = task("beads", "bd-1", ["work", "triage-me"]);
        const beads = fakeTracker("beads", calls, statesOf(marked));
        const written = await applyDerivations(
            [],
            tasksOf(marked),
            trackersOf(beads, beads, beads),
            true,
        );
        expect(written.unmarked).toEqual([]);
        expect(calls).toEqual([]);
    });

    it("keeps triage-me on a marked task in conflict", async () => {
        const calls: string[] = [];
        const marked = task("beads", "bd-1", ["work", "AFK", "HITL", "proposal", "triage-me"]);
        const beads = fakeTracker("beads", calls, statesOf(marked));
        const written = await applyDerivations(
            [],
            tasksOf(marked),
            trackersOf(beads, beads, beads),
            true,
        );
        expect(written.unmarked).toEqual([]);
        expect(calls).toEqual([]);
    });

    it("keeps triage-me on a marked task whose write failed or was skipped for a missing label", async () => {
        const calls: string[] = [];
        const missing = task("linear", "DOT-1", ["work", "AFK", "triage-me"]);
        const failing = task("linear", "DOT-2", ["work", "AFK", "triage-me"]);
        const states = statesOf(missing, failing);
        states.set("DOT-2", {
            labels: [...failing.labels],
            addLabelResult: () => ({ ok: false, error: "linear issue update: boom" }),
        });
        const linear = fakeTracker("linear", calls, states, [label("workspace", "plan")]);
        const beads = fakeTracker("beads", calls, new Map());
        const written = await applyDerivations(
            [
                derivation({
                    source: "linear",
                    taskId: "DOT-1",
                    group: "stage",
                    labels: ["proposal"],
                }),
                derivation({
                    source: "linear",
                    taskId: "DOT-2",
                    group: "stage",
                    labels: ["plan"],
                }),
            ],
            tasksOf(missing, failing),
            trackersOf(beads, beads, linear),
            true,
        );
        expect(written.records.map((record) => record.status)).toEqual(["proposed", "failed"]);
        expect(written.unmarked).toEqual([]);
        expect(calls.filter((call) => call.includes("removeLabel"))).toEqual([]);
    });

    it("without --apply proposes the removal, counting the labels it would write, and issues no call", async () => {
        const calls: string[] = [];
        const byPerson = task("beads", "bd-1", ["personal", "HITL", "proposal", "triage-me"]);
        const byRule = task("beads", "bd-2", ["work", "AFK", "triage-me"]);
        const beads = fakeTracker("beads", calls, statesOf(byPerson, byRule));
        const written = await applyDerivations(
            [derivation({ taskId: "bd-2", group: "stage", labels: ["proposal"] })],
            tasksOf(byPerson, byRule),
            trackersOf(beads, beads, beads),
            false,
        );
        expect(written.unmarked).toEqual([
            { source: "beads", taskId: "bd-1", status: "proposed", detail: null },
            { source: "beads", taskId: "bd-2", status: "proposed", detail: null },
        ]);
        expect(calls).toEqual([]);
    });

    it("without --apply does not propose a removal that rests on a label the tracker lacks", async () => {
        const calls: string[] = [];
        const marked = task("linear", "DOT-1", ["work", "AFK", "triage-me"]);
        const linear = fakeTracker("linear", calls, statesOf(marked), [
            label("workspace", "triage-me"),
        ]);
        const beads = fakeTracker("beads", calls, new Map());
        const written = await applyDerivations(
            [
                derivation({
                    source: "linear",
                    taskId: "DOT-1",
                    group: "stage",
                    labels: ["proposal"],
                }),
            ],
            tasksOf(marked),
            trackersOf(beads, beads, linear),
            false,
        );
        expect(written.records.map((record) => record.status)).toEqual(["proposed"]);
        expect(written.unmarked).toEqual([]);
    });
});

describe("applyDerivations: A failed removal of the mark", () => {
    it("Removal not confirmed: failed with the labels found, no write failure, and the source keeps going", async () => {
        const calls: string[] = [];
        const stuck = task("linear", "DOT-1", ["work", "AFK", "proposal", "triage-me"]);
        const next = task("linear", "DOT-2", ["personal", "grill-me", "triage-me"]);
        const states = statesOf(stuck, next);
        states.set("DOT-1", { labels: [...stuck.labels], keepsOnRemove: true });
        const linear = fakeTracker("linear", calls, states, "must not be listed");
        const beads = fakeTracker("beads", calls, new Map());
        const pending = applyDerivations(
            [],
            tasksOf(stuck, next),
            trackersOf(beads, beads, linear),
            true,
        );
        await vi.runAllTimersAsync();
        const written = await pending;
        expect(written.unmarked).toEqual([
            {
                source: "linear",
                taskId: "DOT-1",
                status: "failed",
                detail: "triage-me still present after removal: [work, AFK, proposal, triage-me] (read 6 times over 30 s)",
            },
            { source: "linear", taskId: "DOT-2", status: "applied", detail: null },
        ]);
        expect(written.failures).toEqual([]);
        expect(calls).toEqual([
            "linear:removeLabel:DOT-1:triage-me",
            ...Array<string>(6).fill("linear:readTask:DOT-1"),
            "linear:removeLabel:DOT-2:triage-me",
            "linear:readTask:DOT-2",
        ]);
    });

    it("reports a removal command that fails with its error and the labels known, stopping nothing", async () => {
        const calls: string[] = [];
        const marked = task("beads", "bd-1", ["work", "AFK", "proposal", "triage-me"]);
        const states = statesOf(marked);
        states.set("bd-1", {
            labels: [...marked.labels],
            removeLabelResult: { ok: false, error: "bd label remove: boom" },
        });
        const beads = fakeTracker("beads", calls, states);
        const doubt = task("linear", "DOT-1", []);
        const linear = fakeTracker("linear", calls, statesOf(doubt), [
            label("workspace", "triage-me"),
        ]);
        const written = await applyDerivations(
            [],
            tasksOf(marked, doubt),
            trackersOf(beads, beads, linear),
            true,
            marks(doubt),
        );
        expect(written.unmarked).toEqual([
            {
                source: "beads",
                taskId: "bd-1",
                status: "failed",
                detail: "bd label remove: boom (labels [work, AFK, proposal, triage-me])",
            },
        ]);
        expect(written.marked.map((record) => record.status)).toEqual(["applied"]);
        expect(written.failures).toEqual([]);
    });

    it("reports a read-back that fails after the removal with the read's error", async () => {
        const calls: string[] = [];
        const marked = task("beads", "bd-1", ["work", "AFK", "proposal", "triage-me"]);
        const states = statesOf(marked);
        states.set("bd-1", {
            labels: [...marked.labels],
            readTaskResult: () => ({ ok: false, error: "bd show: boom" }),
        });
        const beads = fakeTracker("beads", calls, states);
        const written = await applyDerivations(
            [],
            tasksOf(marked),
            trackersOf(beads, beads, beads),
            true,
        );
        expect(written.unmarked).toEqual([
            { source: "beads", taskId: "bd-1", status: "failed", detail: "bd show: boom" },
        ]);
        expect(written.failures).toEqual([]);
    });
});

describe("applyDerivations: Trackers can remove a label", () => {
    it("Triage never removes: no removal command when no task it reads carries triage-me", async () => {
        const calls: string[] = [];
        const done = task("beads", "bd-1", ["personal", "HITL", "proposal"]);
        const doubt = task("beads", "bd-2", ["nazaries"]);
        const beads = fakeTracker("beads", calls, statesOf(done, doubt));
        await applyDerivations(
            [derivation({ taskId: "bd-2" })],
            tasksOf(done, doubt),
            trackersOf(beads, beads, beads),
            true,
            marks(doubt),
        );
        expect(calls.filter((call) => call.includes("removeLabel"))).toEqual([]);
    });

    it("Triage removes only the triage label from a complete task", async () => {
        const calls: string[] = [];
        const marked = task("beads", "bd-1", ["work", "AFK", "bug", "triage-me"]);
        const states = statesOf(marked);
        const beads = fakeTracker("beads", calls, states);
        await applyDerivations(
            [derivation({ group: "stage", labels: ["proposal"] })],
            tasksOf(marked),
            trackersOf(beads, beads, beads),
            true,
        );
        expect(calls.filter((call) => call.includes("removeLabel"))).toEqual([
            "beads:removeLabel:bd-1:triage-me",
        ]);
        expect(states.get("bd-1")?.labels).toEqual(["work", "AFK", "bug", "proposal"]);
    });
});

describe("applyDerivations: Write only with --apply, additively, with read-back", () => {
    it("Default is read-only: marks and removals are proposed and no CLI write is issued", async () => {
        const calls: string[] = [];
        const doubt = task("beads", "bd-1", ["nazaries"]);
        const marked = task("beads", "bd-2", ["personal", "HITL", "proposal", "triage-me"]);
        const beads = fakeTracker("beads", calls, statesOf(doubt, marked));
        const written = await applyDerivations(
            [derivation()],
            tasksOf(doubt, marked),
            trackersOf(beads, beads, beads),
            false,
            marks(doubt),
        );
        expect(
            [...written.records, ...written.marked, ...written.unmarked].map((r) => r.status),
        ).toEqual(["proposed", "proposed", "proposed"]);
        expect(calls).toEqual([]);
    });
});
