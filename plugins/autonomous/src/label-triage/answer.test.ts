import { describe, expect, it } from "vitest";

import type { Answer } from "../args.ts";
import type { AutonomousConfig } from "../config.ts";
import { detect } from "../label-contract/detect.ts";
import type { AnswerContext } from "../runner.ts";
import { answerLabelTriage } from "./answer.ts";
import { config, task, trackers } from "./test-fixtures.ts";
import type { Trackers } from "./trackers/tracker.ts";

function context(given: Trackers, overrides: Partial<AutonomousConfig> = {}): AnswerContext {
    return { config: { ...config(), ...overrides }, trackers: given };
}

function answer(id: string, ...values: string[]): Answer {
    return { id, values };
}

async function labelsOf(given: Trackers, taskId: string): Promise<string[]> {
    const read = await given.beads.readTask(taskId);
    return read.ok ? read.value.labels : [];
}

describe("answers to triage questions", () => {
    it("adds the answered label, keeps the task's other labels and reads it back", async () => {
        const calls: string[] = [];
        const given = trackers(calls, { beads: [task("beads", "X-12", ["work", "bug"])] });
        const records = await answerLabelTriage(
            [answer("label-triage:beads:X-12:entry", "HITL")],
            context(given),
        );
        expect(records).toEqual([
            {
                id: "label-triage:beads:X-12:entry",
                labels: ["HITL"],
                status: "applied",
                detail: "added HITL to beads X-12, read back",
            },
        ]);
        expect(calls).toEqual([
            "beads:readTask:X-12",
            "beads:addLabel:X-12:HITL",
            "beads:readTask:X-12",
        ]);
        expect(await labelsOf(given, "X-12")).toEqual(["work", "bug", "HITL"]);
    });

    it("skips a group labelled in the meantime, naming the label found, and writes nothing", async () => {
        const calls: string[] = [];
        const given = trackers(calls, {
            beads: [task("beads", "X-12", ["work", "AFK"]), task("beads", "X-13", ["AFK", "HITL"])],
        });
        const records = await answerLabelTriage(
            [
                answer("label-triage:beads:X-12:entry", "HITL"),
                answer("label-triage:beads:X-13:entry", "grill-me"),
            ],
            context(given),
        );
        expect(records).toEqual([
            {
                id: "label-triage:beads:X-12:entry",
                labels: ["HITL"],
                status: "skipped",
                detail: "entry already present: AFK",
            },
            {
                id: "label-triage:beads:X-13:entry",
                labels: ["grill-me"],
                status: "skipped",
                detail: "entry in conflict: AFK, HITL",
            },
        ]);
        expect(calls).toEqual(["beads:readTask:X-12", "beads:readTask:X-13"]);
    });

    it("rejects a label from another group without reading or writing", async () => {
        const calls: string[] = [];
        const given = trackers(calls, { beads: [task("beads", "X-12", [])] });
        const records = await answerLabelTriage(
            [answer("label-triage:beads:X-12:entry", "work")],
            context(given),
        );
        expect(records).toEqual([
            {
                id: "label-triage:beads:X-12:entry",
                labels: ["work"],
                status: "rejected",
                detail: "invalid for entry: unknown label work",
            },
        ]);
        expect(calls).toEqual([]);
    });

    it("applies an answer against the evidence: work is added and nazaries remains", async () => {
        const calls: string[] = [];
        const base = config();
        const sources = {
            ...base.sources,
            beads: { ...base.sources.beads, scope: "personal" as const },
        };
        const listed = task("beads", "X-3", ["nazaries"]);
        // The run asked this scope: alias nazaries says work, the structural rule personal.
        expect(detect(listed, sources.beads).groups.scope).toMatchObject({
            status: "missing",
            evidence: [{ label: "work" }, { label: "personal" }],
        });
        const given = trackers(calls, { beads: [listed] });
        const records = await answerLabelTriage(
            [answer("label-triage:beads:X-3:scope", "work")],
            context(given, { sources }),
        );
        expect(records).toEqual([
            {
                id: "label-triage:beads:X-3:scope",
                labels: ["work"],
                status: "applied",
                detail: "added work to beads X-3, read back",
            },
        ]);
        expect(await labelsOf(given, "X-3")).toEqual(["nazaries", "work"]);
    });

    it("fails an answer on a read-back mismatch and writes no further answer to that source", async () => {
        const calls: string[] = [];
        const given = trackers(
            calls,
            {
                linear: [
                    task("linear", "DOT-1", ["personal", "bug"]),
                    task("linear", "DOT-2", ["personal"]),
                ],
                beads: [task("beads", "X-12", ["work"])],
            },
            { linear: { dropsOnAdd: "bug" } },
        );
        const records = await answerLabelTriage(
            [
                answer("label-triage:linear:DOT-1:entry", "HITL"),
                answer("label-triage:linear:DOT-2:entry", "AFK"),
                answer("label-triage:beads:X-12:entry", "HITL"),
            ],
            context(given),
        );
        expect(records).toEqual([
            {
                id: "label-triage:linear:DOT-1:entry",
                labels: ["HITL"],
                status: "failed",
                detail: "read-back mismatch: before [personal, bug] + [HITL] → after [personal, HITL]",
            },
            {
                id: "label-triage:linear:DOT-2:entry",
                labels: ["AFK"],
                status: "failed",
                detail: "not written after a write failure on linear",
            },
            {
                id: "label-triage:beads:X-12:entry",
                labels: ["HITL"],
                status: "applied",
                detail: "added HITL to beads X-12, read back",
            },
        ]);
        expect(calls).toEqual([
            "linear:readTask:DOT-1",
            "linear:readTask:DOT-2",
            "beads:readTask:X-12",
            "beads:addLabel:X-12:HITL",
            "beads:readTask:X-12",
            "linear:addLabel:DOT-1:HITL",
            "linear:readTask:DOT-1",
        ]);
    });

    it("fails an answer on a write error, naming the labels before", async () => {
        const calls: string[] = [];
        const error = "linear issue update DOT-1 --label HITL: forbidden";
        const given = trackers(
            calls,
            { linear: [task("linear", "DOT-1", ["personal"])] },
            { linear: { addLabelError: error } },
        );
        const records = await answerLabelTriage(
            [answer("label-triage:linear:DOT-1:entry", "HITL")],
            context(given),
        );
        expect(records).toEqual([
            {
                id: "label-triage:linear:DOT-1:entry",
                labels: ["HITL"],
                status: "failed",
                detail: `${error} (before [personal])`,
            },
        ]);
    });

    it("fails an answer whose write was cut short, naming the labels before and after", async () => {
        const calls: string[] = [];
        const error = "bd label add X-12 HITL: database is locked";
        const given = trackers(
            calls,
            { beads: [task("beads", "X-12", ["work"])] },
            { beads: { addLabelErrors: { HITL: error } } },
        );
        const records = await answerLabelTriage(
            [answer("label-triage:beads:X-12:entry", "HITL", "grill-me")],
            context(given),
        );
        expect(records).toEqual([
            {
                id: "label-triage:beads:X-12:entry",
                labels: ["HITL", "grill-me"],
                status: "failed",
                detail: `${error} (before [work] → after [work, grill-me])`,
            },
        ]);
    });

    it.each([
        ["an unknown source", answer("label-triage:jira:X-1:entry", "HITL"), "unknown source jira"],
        [
            "a disabled source",
            answer("label-triage:github:owner/repo#1:entry", "HITL"),
            "github is not enabled",
        ],
        ["an unknown group", answer("label-triage:beads:X-1:stage", "HITL"), "unknown group stage"],
        [
            "a malformed id",
            answer("label-triage:beads:X-1", "HITL"),
            "unknown question label-triage:beads:X-1",
        ],
        [
            "AFK with HITL",
            answer("label-triage:beads:X-1:entry", "AFK", "HITL"),
            "invalid for entry: AFK with HITL",
        ],
        [
            "two scope labels",
            answer("label-triage:beads:X-1:scope", "work", "personal"),
            "invalid for scope: two scope labels: work, personal",
        ],
    ])("rejects %s without reading or writing", async (_, given, detail) => {
        const calls: string[] = [];
        const base = config();
        const sources = { ...base.sources, github: { ...base.sources.github, enabled: false } };
        const records = await answerLabelTriage(
            [given],
            context(trackers(calls, { beads: [task("beads", "X-1", [])] }), { sources }),
        );
        expect(records).toEqual([
            { id: given.id, labels: given.values, status: "rejected", detail },
        ]);
        expect(calls).toEqual([]);
    });

    it("fails an answer whose task cannot be read, with the tracker error", async () => {
        const calls: string[] = [];
        const error = "bd show X-12 --json: bd CLI not found on PATH";
        const given = trackers(
            calls,
            { beads: [task("beads", "X-12", [])] },
            { beads: { readErrors: { "X-12": error } } },
        );
        const records = await answerLabelTriage(
            [answer("label-triage:beads:X-12:entry", "HITL")],
            context(given),
        );
        expect(records).toEqual([
            {
                id: "label-triage:beads:X-12:entry",
                labels: ["HITL"],
                status: "failed",
                detail: error,
            },
        ]);
        expect(calls).toEqual(["beads:readTask:X-12"]);
    });

    it("returns the records in input order, though the writes run source by source", async () => {
        const calls: string[] = [];
        const given = trackers(calls, {
            linear: [task("linear", "DOT-1", ["personal"])],
            beads: [task("beads", "X-12", ["bug"])],
        });
        const ids = [
            "label-triage:linear:DOT-1:entry",
            "quota-gate:beads:X-12:entry",
            "label-triage:beads:X-12:entry",
            "label-triage:beads:X-12:scope",
        ];
        const values = ["HITL", "AFK", "AFK", "personal"];
        const records = await answerLabelTriage(
            ids.map((id, index) => answer(id, values[index] ?? "")),
            context(given),
        );
        expect(records.map(({ id, status }) => [id, status])).toEqual([
            [ids[0], "applied"],
            [ids[1], "rejected"],
            [ids[2], "applied"],
            [ids[3], "applied"],
        ]);
        expect(calls.filter((call) => call.includes("addLabel"))).toEqual([
            "beads:addLabel:X-12:AFK",
            "beads:addLabel:X-12:personal",
            "linear:addLabel:DOT-1:HITL",
        ]);
        expect(await labelsOf(given, "X-12")).toEqual(["bug", "AFK", "personal"]);
    });
});
