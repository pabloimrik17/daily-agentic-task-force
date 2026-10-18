import { describe, expect, it } from "vitest";

import type { Source } from "../config.ts";
import type { Tracker, TrackerResult, TrackerTask } from "../label-triage/trackers/tracker.ts";
import { addTaken, removeTaken, TAKEN } from "./taken.ts";

interface Script {
    labels: string[];
    addError?: string;
    removeError?: string;
    readError?: string;
    keepsOnRemove?: boolean; // the command succeeds but the tracker leaves the label
    dropsOnAdd?: boolean; // the command succeeds but the tracker loses the label
}

// A tracker over one task whose label writes can be made to lie.
function tracker(script: Script, source: Source = "beads"): Tracker & { calls: string[] } {
    const calls: string[] = [];
    let labels = [...script.labels];
    const refuse = (): Promise<never> => Promise.reject(new Error("not expected"));
    return {
        calls,
        source,
        labelScopes: [],
        createsLabels: false,
        listTasks: refuse,
        listLabels: refuse,
        createLabel: refuse,
        readTask: (id): Promise<TrackerResult<TrackerTask>> => {
            calls.push(`readTask:${id}`);
            if (script.readError !== undefined) {
                return Promise.resolve({ ok: false, error: script.readError });
            }
            return Promise.resolve({
                ok: true,
                value: {
                    source,
                    id,
                    title: "A task",
                    description: "",
                    labels,
                    status: "open",
                    updatedAt: "",
                },
            });
        },
        addLabel: (id, label) => {
            calls.push(`addLabel:${id}:${label}`);
            if (script.addError !== undefined) {
                return Promise.resolve({ ok: false, error: script.addError });
            }
            labels = script.dropsOnAdd === true ? labels : [...labels, label];
            return Promise.resolve({ ok: true, value: undefined });
        },
        removeLabel: (id, label) => {
            calls.push(`removeLabel:${id}:${label}`);
            if (script.removeError !== undefined) {
                return Promise.resolve({ ok: false, error: script.removeError });
            }
            labels = script.keepsOnRemove === true ? labels : labels.filter((l) => l !== label);
            return Promise.resolve({ ok: true, value: undefined });
        },
    };
}

describe("addTaken", () => {
    it("adds taken and confirms it on the read-back", async () => {
        const beads = tracker({ labels: ["work", "AFK"] });

        expect(await addTaken(beads, "kc2.29")).toEqual({ ok: true });
        expect(beads.calls).toEqual(["addLabel:kc2.29:taken", "readTask:kc2.29"]);
    });

    it("fails with the labels found when the read-back lacks taken", async () => {
        const beads = tracker({ labels: ["work", "AFK"], dropsOnAdd: true });

        expect(await addTaken(beads, "kc2.29")).toEqual({
            ok: false,
            error: "taken missing from beads:kc2.29 after add: [work, AFK]",
            labels: ["work", "AFK"],
        });
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

    it("reports a failing read-back with no labels found", async () => {
        const beads = tracker({ labels: [], readError: "bd show x --json: boom" });

        expect(await addTaken(beads, "x")).toEqual({
            ok: false,
            error: "bd show x --json: boom",
            labels: null,
        });
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

    it("fails with the labels found when the read-back still shows taken", async () => {
        const github = tracker({ labels: ["a", "b", TAKEN], keepsOnRemove: true }, "github");

        expect(await removeTaken(github, "owner/repo#12")).toEqual({
            ok: false,
            error: "taken still on github:owner/repo#12 after removal: [a, b, taken]",
            labels: ["a", "b", "taken"],
        });
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

    it("reports a failing read-back with no labels found", async () => {
        const beads = tracker({ labels: [TAKEN], readError: "bd show x --json: boom" });

        expect(await removeTaken(beads, "x")).toEqual({
            ok: false,
            error: "bd show x --json: boom",
            labels: null,
        });
    });
});
