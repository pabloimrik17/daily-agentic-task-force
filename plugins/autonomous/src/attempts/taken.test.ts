import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Source } from "../config.ts";
import { inertDocumentMethods } from "../label-triage/test-fixtures.ts";
import type { Tracker, TrackerResult, TrackerTask } from "../label-triage/trackers/tracker.ts";
import { addTaken, removeTaken, TAKEN } from "./taken.ts";

interface Script {
    labels: string[];
    addError?: string;
    removeError?: string;
    readError?: string;
    readErrorAfterWrite?: string; // only the reads after a write fail
    keepsOnRemove?: boolean; // the command succeeds but the tracker leaves the label
    dropsOnAdd?: boolean; // the command succeeds but the tracker loses the label
    staleReads?: number; // after a write, this many reads still return the labels from before it
}

// A tracker over one task whose label writes can be made to lie.
function tracker(script: Script, source: Source = "beads"): Tracker & { calls: string[] } {
    const calls: string[] = [];
    let labels = [...script.labels];
    let stale = labels;
    let lag = 0;
    let wrote = false;
    const written = () => {
        stale = labels;
        lag = script.staleReads ?? 0;
        wrote = true;
    };
    const current = () => {
        if (lag === 0) {
            return labels;
        }
        lag -= 1;
        return stale;
    };
    const refuse = (): Promise<never> => Promise.reject(new Error("not expected"));
    return {
        calls,
        source,
        labelScopes: [],
        createsLabels: false,
        listTasks: refuse,
        listLabels: refuse,
        createLabel: refuse,
        recolourLabel: refuse,
        ...inertDocumentMethods,
        readTask: (id): Promise<TrackerResult<TrackerTask>> => {
            calls.push(`readTask:${id}`);
            const error = script.readError ?? (wrote ? script.readErrorAfterWrite : undefined);
            if (error !== undefined) {
                return Promise.resolve({ ok: false, error });
            }
            return Promise.resolve({
                ok: true,
                value: {
                    source,
                    id,
                    title: "A task",
                    description: "",
                    labels: current(),
                    status: "open",
                    updatedAt: "",
                    closed: false,
                },
            });
        },
        addLabel: (id, label) => {
            calls.push(`addLabel:${id}:${label}`);
            if (script.addError !== undefined) {
                return Promise.resolve({ ok: false, error: script.addError });
            }
            written();
            labels = script.dropsOnAdd === true ? labels : [...labels, label];
            return Promise.resolve({ ok: true, value: undefined });
        },
        removeLabel: (id, label) => {
            calls.push(`removeLabel:${id}:${label}`);
            if (script.removeError !== undefined) {
                return Promise.resolve({ ok: false, error: script.removeError });
            }
            written();
            labels = script.keepsOnRemove === true ? labels : labels.filter((l) => l !== label);
            return Promise.resolve({ ok: true, value: undefined });
        },
    };
}

// The read-back waits on the global timer: the fake one lets a test run its waits at once.
beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

const reads = (calls: readonly string[]) => calls.filter((call) => call.startsWith("readTask:"));

describe("addTaken", () => {
    it("adds taken and confirms it on the read-back", async () => {
        const beads = tracker({ labels: ["work", "AFK"] });

        expect(await addTaken(beads, "kc2.29")).toEqual({ ok: true });
        expect(beads.calls).toEqual(["addLabel:kc2.29:taken", "readTask:kc2.29"]);
    });

    it("reads again while the tracker lags, and confirms taken once it shows", async () => {
        const beads = tracker({ labels: ["work", "AFK"], staleReads: 2 });

        const pending = addTaken(beads, "kc2.29");
        await vi.runAllTimersAsync();

        expect(await pending).toEqual({ ok: true });
        expect(beads.calls).toEqual([
            "addLabel:kc2.29:taken",
            "readTask:kc2.29",
            "readTask:kc2.29",
            "readTask:kc2.29",
        ]);
    });

    it("fails with the labels found when no read shows taken, after reading 6 times over 30 s", async () => {
        const beads = tracker({ labels: ["work", "AFK"], dropsOnAdd: true });

        const pending = addTaken(beads, "kc2.29");
        await vi.runAllTimersAsync();

        expect(await pending).toEqual({
            ok: false,
            error: "taken missing from beads:kc2.29 after add: [work, AFK] (read 6 times over 30 s)",
            labels: ["work", "AFK"],
        });
        expect(reads(beads.calls)).toHaveLength(6);
    });

    it("reports a failing command without reading the task", async () => {
        const beads = tracker({ labels: [], addError: "bd label add x taken: boom" });

        expect(await addTaken(beads, "x")).toEqual({
            ok: false,
            error: "bd label add x taken: boom",
            labels: null,
        });
        expect(beads.calls).toEqual(["addLabel:x:taken"]);
    });

    it("reports a failing read-back with no labels found, without reading again", async () => {
        const beads = tracker({ labels: [], readError: "bd show x --json: boom" });

        expect(await addTaken(beads, "x")).toEqual({
            ok: false,
            error: "bd show x --json: boom",
            labels: null,
        });
        expect(beads.calls).toEqual(["addLabel:x:taken", "readTask:x"]);
    });
});

describe("removeTaken", () => {
    it("treats an absent taken as removed without issuing the command", async () => {
        const linear = tracker({ labels: ["work", "AFK"] }, "linear");

        expect(await removeTaken(linear, "DOT-109")).toEqual({ ok: true });
        expect(linear.calls).toEqual(["readTask:DOT-109"]);
    });

    it("removes taken, leaves every other label and confirms the read-back", async () => {
        const beads = tracker({ labels: ["work", "grill-me", TAKEN] });

        expect(await removeTaken(beads, "kc2.29")).toEqual({ ok: true });
        expect(beads.calls).toEqual([
            "readTask:kc2.29",
            "removeLabel:kc2.29:taken",
            "readTask:kc2.29",
        ]);
        const read = await beads.readTask("kc2.29");
        expect(read.ok && read.value.labels).toEqual(["work", "grill-me"]);
    });

    it("reads again while the tracker lags, and confirms the removal once it shows", async () => {
        const linear = tracker({ labels: ["work", TAKEN], staleReads: 3 }, "linear");

        const pending = removeTaken(linear, "DOT-109");
        await vi.runAllTimersAsync();

        expect(await pending).toEqual({ ok: true });
        expect(linear.calls).toEqual([
            "readTask:DOT-109",
            "removeLabel:DOT-109:taken",
            "readTask:DOT-109",
            "readTask:DOT-109",
            "readTask:DOT-109",
            "readTask:DOT-109",
        ]);
    });

    it("fails with the labels found when every read still shows taken, after reading 6 times over 30 s", async () => {
        const github = tracker({ labels: ["a", "b", TAKEN], keepsOnRemove: true }, "github");

        const pending = removeTaken(github, "owner/repo#12");
        await vi.runAllTimersAsync();

        expect(await pending).toEqual({
            ok: false,
            error: "taken still on github:owner/repo#12 after removal: [a, b, taken] (read 6 times over 30 s)",
            labels: ["a", "b", "taken"],
        });
        expect(reads(github.calls)).toHaveLength(1 + 6);
    });

    it("reports a failing command after the read that found taken", async () => {
        const linear = tracker(
            { labels: [TAKEN], removeError: "linear issue update: boom" },
            "linear",
        );

        expect(await removeTaken(linear, "DOT-109")).toEqual({
            ok: false,
            error: "linear issue update: boom",
            labels: null,
        });
        expect(linear.calls).toEqual(["readTask:DOT-109", "removeLabel:DOT-109:taken"]);
    });

    it("reports a failing read-back with no labels found, without reading again", async () => {
        const beads = tracker({ labels: [TAKEN], readErrorAfterWrite: "bd show x --json: boom" });

        expect(await removeTaken(beads, "x")).toEqual({
            ok: false,
            error: "bd show x --json: boom",
            labels: null,
        });
        expect(beads.calls).toEqual(["readTask:x", "removeLabel:x:taken", "readTask:x"]);
    });

    it("reports a failing first read with no labels found", async () => {
        const beads = tracker({ labels: [TAKEN], readError: "bd show x --json: boom" });

        expect(await removeTaken(beads, "x")).toEqual({
            ok: false,
            error: "bd show x --json: boom",
            labels: null,
        });
        expect(beads.calls).toEqual(["readTask:x"]);
    });
});
