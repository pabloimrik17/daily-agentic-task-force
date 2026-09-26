import { describe, expect, it } from "vitest";

import type { Derivation } from "./rules.ts";
import type { Tracker, TrackerResult, TrackerTask, Trackers } from "./trackers/tracker.ts";
import { applyDerivations, taskKey } from "./write.ts";

interface FakeState {
    labels: string[];
    addLabelResult?: (label: string) => TrackerResult<void>;
    readTaskResult?: () => TrackerResult<TrackerTask>;
}

function fakeTracker(
    source: Tracker["source"],
    calls: string[],
    states: Map<string, FakeState>,
): Tracker {
    return {
        source,
        labelScopes: [],
        createsLabels: false,
        listTasks: () => Promise.resolve({ ok: true, value: [] }),
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
                },
            });
        },
        listLabels: () => Promise.resolve({ ok: true, value: [] }),
        createLabel: () => Promise.resolve({ ok: true, value: undefined }),
    };
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

describe("applyDerivations", () => {
    it("proposes every eligible derivation and issues no tracker call without --apply", async () => {
        const calls: string[] = [];
        const states = new Map<string, FakeState>([["bd-1", { labels: ["nazaries"] }]]);
        const beads = fakeTracker("beads", calls, states);
        const tasks = new Map([[taskKey("beads", "bd-1"), task("beads", "bd-1", ["nazaries"])]]);
        const { records, failures } = await applyDerivations(
            [derivation()],
            tasks,
            trackersOf(beads, beads, beads),
            false,
        );
        expect(records).toEqual([{ ...derivation(), status: "proposed", detail: null }]);
        expect(failures).toEqual([]);
        expect(calls).toEqual([]);
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

    it("calls addLabel once per label and readTask once for a derivation with two labels", async () => {
        const calls: string[] = [];
        const states = new Map<string, FakeState>([["bd-1", { labels: [] }]]);
        const beads = fakeTracker("beads", calls, states);
        const tasks = new Map([[taskKey("beads", "bd-1"), task("beads", "bd-1", [])]]);
        await applyDerivations(
            [derivation({ group: "entry", labels: ["AFK", "grill-me"] })],
            tasks,
            trackersOf(beads, beads, beads),
            true,
        );
        expect(calls).toEqual([
            "beads:addLabel:bd-1:AFK",
            "beads:addLabel:bd-1:grill-me",
            "beads:readTask:bd-1",
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
            group: "entry",
            labels: ["personal"],
        });
        const second = derivation({
            source: "linear",
            taskId: "lin-1",
            group: "scope",
            labels: ["AFK"],
        });
        const other = derivation({ source: "beads" });
        const { records, failures } = await applyDerivations(
            [first, second, other],
            tasks,
            trackersOf(beads, beads, linear),
            true,
        );
        expect(records).toEqual([
            { ...other, status: "applied", detail: null },
            {
                ...first,
                status: "failed",
                detail: "read-back mismatch: before [work] + [personal] → after [work]",
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
                error: "read-back mismatch: before [work] + [personal] → after [work]",
            },
        ]);
        expect(calls).toEqual([
            "beads:addLabel:bd-1:work",
            "beads:readTask:bd-1",
            "linear:addLabel:lin-1:personal",
            "linear:readTask:lin-1",
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
