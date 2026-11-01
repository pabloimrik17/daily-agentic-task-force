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

async function labelsOf(
    given: Trackers,
    taskId: string,
    source: "beads" | "linear" = "beads",
): Promise<string[]> {
    const read = await given[source].readTask(taskId);
    return read.ok ? read.value.labels : [];
}

describe("answers to triage questions: Apply answers to triage questions", () => {
    it("Answer applied: HITL and proposal are added, the other labels remain, and the task is read back", async () => {
        const calls: string[] = [];
        const given = trackers(calls, { beads: [task("beads", "X-12", ["work", "bug"])] });
        const records = await answerLabelTriage(
            [answer("label-triage:beads:X-12:autonomy", "HITL")],
            context(given),
        );
        expect(records).toEqual([
            {
                id: "label-triage:beads:X-12:autonomy",
                labels: ["HITL"],
                status: "applied",
                detail: "added HITL, proposal to beads X-12, read back",
            },
        ]);
        expect(calls).toEqual([
            "beads:readTask:X-12",
            "beads:addLabel:X-12:HITL",
            "beads:readTask:X-12",
            "beads:addLabel:X-12:proposal",
            "beads:readTask:X-12",
        ]);
        expect(await labelsOf(given, "X-12")).toEqual(["work", "bug", "HITL", "proposal"]);
    });

    it("Grill chosen: only grill-me is added", async () => {
        const calls: string[] = [];
        const given = trackers(calls, { beads: [task("beads", "X-12", ["personal"])] });
        const records = await answerLabelTriage(
            [answer("label-triage:beads:X-12:autonomy", "grill-me")],
            context(given),
        );
        expect(records).toEqual([
            {
                id: "label-triage:beads:X-12:autonomy",
                labels: ["grill-me"],
                status: "applied",
                detail: "added grill-me to beads X-12, read back",
            },
        ]);
        expect(calls.filter((call) => call.includes("addLabel"))).toEqual([
            "beads:addLabel:X-12:grill-me",
        ]);
        expect(await labelsOf(given, "X-12")).toEqual(["personal", "grill-me"]);
    });

    it("Grill chosen after a stage was set: skipped, naming proposal, and nothing is written", async () => {
        const calls: string[] = [];
        const given = trackers(calls, { beads: [task("beads", "X-12", ["personal", "proposal"])] });
        const records = await answerLabelTriage(
            [answer("label-triage:beads:X-12:autonomy", "grill-me")],
            context(given),
        );
        expect(records).toEqual([
            {
                id: "label-triage:beads:X-12:autonomy",
                labels: ["grill-me"],
                status: "skipped",
                detail: "stage already present: proposal",
            },
        ]);
        expect(calls).toEqual(["beads:readTask:X-12"]);
    });

    it("Group labelled in the meantime: skipped, naming the label found, and nothing is written", async () => {
        const calls: string[] = [];
        const given = trackers(calls, {
            beads: [
                task("beads", "X-12", ["work", "AFK"]),
                task("beads", "X-13", ["AFK", "HITL"]),
                task("beads", "X-14", ["personal", "grill-me"]),
            ],
        });
        const records = await answerLabelTriage(
            [
                answer("label-triage:beads:X-12:autonomy", "HITL"),
                answer("label-triage:beads:X-13:autonomy", "grill-me"),
                answer("label-triage:beads:X-14:autonomy", "HITL"),
            ],
            context(given),
        );
        expect(records).toEqual([
            {
                id: "label-triage:beads:X-12:autonomy",
                labels: ["HITL"],
                status: "skipped",
                detail: "autonomy already present: AFK",
            },
            {
                id: "label-triage:beads:X-13:autonomy",
                labels: ["grill-me"],
                status: "skipped",
                detail: "autonomy in conflict: AFK, HITL",
            },
            // A deferred autonomy counts as present: the task is in grill-me.
            {
                id: "label-triage:beads:X-14:autonomy",
                labels: ["HITL"],
                status: "skipped",
                detail: "autonomy already present: grill-me",
            },
        ]);
        expect(calls).toEqual([
            "beads:readTask:X-12",
            "beads:readTask:X-13",
            "beads:readTask:X-14",
        ]);
    });

    it("Label from another group: work for an autonomy question is rejected and nothing is written", async () => {
        const calls: string[] = [];
        const given = trackers(calls, { beads: [task("beads", "X-12", [])] });
        const records = await answerLabelTriage(
            [answer("label-triage:beads:X-12:autonomy", "work")],
            context(given),
        );
        expect(records).toEqual([
            {
                id: "label-triage:beads:X-12:autonomy",
                labels: ["work"],
                status: "rejected",
                detail: "invalid for autonomy: unknown label work",
            },
        ]);
        expect(calls.filter((call) => call.includes("addLabel"))).toEqual([]);
    });

    it("Answer against the evidence: work is added and nazaries remains", async () => {
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

    it("Read-back mismatch: failed with both label sets, and no further Linear answer is written", async () => {
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
                answer("label-triage:linear:DOT-1:autonomy", "HITL"),
                answer("label-triage:linear:DOT-2:autonomy", "AFK"),
                answer("label-triage:beads:X-12:autonomy", "HITL"),
            ],
            context(given),
        );
        expect(records).toEqual([
            {
                id: "label-triage:linear:DOT-1:autonomy",
                labels: ["HITL"],
                status: "failed",
                detail: "read-back mismatch: before [personal, bug] + [HITL] → after [personal, HITL]",
            },
            {
                id: "label-triage:linear:DOT-2:autonomy",
                labels: ["AFK"],
                status: "failed",
                detail: "not written after a write failure on linear",
            },
            {
                id: "label-triage:beads:X-12:autonomy",
                labels: ["HITL"],
                status: "applied",
                detail: "added HITL, proposal to beads X-12, read back",
            },
        ]);
        expect(calls).toEqual([
            "linear:readTask:DOT-1",
            "linear:readTask:DOT-2",
            "beads:readTask:X-12",
            "beads:addLabel:X-12:HITL",
            "beads:readTask:X-12",
            "beads:addLabel:X-12:proposal",
            "beads:readTask:X-12",
            "linear:addLabel:DOT-1:HITL",
            "linear:readTask:DOT-1",
        ]);
    });
});

describe("answers to triage questions: labels the tracker lacks", () => {
    const linearLabels = ["personal", "AFK", "HITL"].map((name) => ({
        scope: "workspace",
        name,
        colour: "#000000",
    }));

    it("fails an answer whose proposal the tracker lacks, naming --bootstrap-labels, without stopping the source", async () => {
        const calls: string[] = [];
        const given = trackers(
            calls,
            {
                linear: [
                    task("linear", "DOT-1", ["personal"]),
                    task("linear", "DOT-2", ["personal", "proposal"]),
                ],
            },
            { linear: { createsLabels: true, labels: linearLabels } },
        );
        const records = await answerLabelTriage(
            [
                answer("label-triage:linear:DOT-1:autonomy", "HITL"),
                answer("label-triage:linear:DOT-2:autonomy", "AFK"),
            ],
            context(given),
        );
        expect(records).toEqual([
            {
                id: "label-triage:linear:DOT-1:autonomy",
                labels: ["HITL"],
                status: "failed",
                detail: "proposal is missing on linear; run --bootstrap-labels",
            },
            {
                id: "label-triage:linear:DOT-2:autonomy",
                labels: ["AFK"],
                status: "applied",
                detail: "added AFK to linear DOT-2, read back",
            },
        ]);
        expect(calls.filter((call) => !call.includes("readTask"))).toEqual([
            "linear:listLabels",
            "linear:addLabel:DOT-1:HITL",
            "linear:addLabel:DOT-2:AFK",
        ]);
        expect(await labelsOf(given, "DOT-1", "linear")).toEqual(["personal", "HITL"]);
    });

    it("fails a grill-me answer the tracker lacks, writing nothing for it", async () => {
        const calls: string[] = [];
        const given = trackers(
            calls,
            { linear: [task("linear", "DOT-1", ["personal"])] },
            { linear: { createsLabels: true, labels: linearLabels } },
        );
        const records = await answerLabelTriage(
            [answer("label-triage:linear:DOT-1:autonomy", "grill-me")],
            context(given),
        );
        expect(records).toEqual([
            {
                id: "label-triage:linear:DOT-1:autonomy",
                labels: ["grill-me"],
                status: "failed",
                detail: "grill-me is missing on linear; run --bootstrap-labels",
            },
        ]);
        expect(calls.filter((call) => call.includes("addLabel"))).toEqual([]);
    });

    it("fails every answer to a source whose labels cannot be listed", async () => {
        const calls: string[] = [];
        const error = "linear label list --all --json: Linear CLI is not authenticated";
        const given = trackers(
            calls,
            { linear: [task("linear", "DOT-1", ["personal"]), task("linear", "DOT-2", [])] },
            { linear: { createsLabels: true, labels: error } },
        );
        const records = await answerLabelTriage(
            [
                answer("label-triage:linear:DOT-1:autonomy", "HITL"),
                answer("label-triage:linear:DOT-2:scope", "personal"),
            ],
            context(given),
        );
        expect(records.map(({ status, detail }) => [status, detail])).toEqual([
            ["failed", `${error} (before [personal])`],
            ["failed", "not written after a write failure on linear"],
        ]);
        expect(calls.filter((call) => call.includes("addLabel"))).toEqual([]);
    });
});

describe("answers to triage questions: writes and rejections", () => {
    it("fails an answer on a write error, naming the labels before", async () => {
        const calls: string[] = [];
        const error = "linear issue update DOT-1 --label HITL: forbidden";
        const given = trackers(
            calls,
            { linear: [task("linear", "DOT-1", ["personal"])] },
            { linear: { addLabelError: error } },
        );
        const records = await answerLabelTriage(
            [answer("label-triage:linear:DOT-1:autonomy", "HITL")],
            context(given),
        );
        expect(records).toEqual([
            {
                id: "label-triage:linear:DOT-1:autonomy",
                labels: ["HITL"],
                status: "failed",
                detail: `${error} (before [personal])`,
            },
        ]);
    });

    it("fails an answer whose proposal write fails after its autonomy landed, naming the labels before", async () => {
        const calls: string[] = [];
        const error = "bd label add X-12 proposal: database is locked";
        const given = trackers(
            calls,
            { beads: [task("beads", "X-12", ["work"])] },
            { beads: { addLabelErrors: { proposal: error } } },
        );
        const records = await answerLabelTriage(
            [answer("label-triage:beads:X-12:autonomy", "HITL")],
            context(given),
        );
        expect(records).toEqual([
            {
                id: "label-triage:beads:X-12:autonomy",
                labels: ["HITL"],
                status: "failed",
                detail: `${error} (before [work, HITL])`,
            },
        ]);
        expect(await labelsOf(given, "X-12")).toEqual(["work", "HITL"]);
    });

    it("writes only the autonomy for a task already in proposal", async () => {
        const calls: string[] = [];
        const given = trackers(calls, { beads: [task("beads", "X-12", ["work", "proposal"])] });
        const records = await answerLabelTriage(
            [answer("label-triage:beads:X-12:autonomy", "AFK")],
            context(given),
        );
        expect(records.map(({ status, detail }) => [status, detail])).toEqual([
            ["applied", "added AFK to beads X-12, read back"],
        ]);
        expect(calls.filter((call) => call.includes("addLabel"))).toEqual([
            "beads:addLabel:X-12:AFK",
        ]);
    });

    it.each([
        [
            "an unknown source",
            answer("label-triage:jira:X-1:autonomy", "HITL"),
            "unknown source jira",
        ],
        [
            "a disabled source",
            answer("label-triage:github:owner/repo#1:autonomy", "HITL"),
            "github is not enabled",
        ],
        [
            "the stage group",
            answer("label-triage:beads:X-1:stage", "proposal"),
            "unknown group stage",
        ],
        [
            "a malformed id",
            answer("label-triage:beads:X-1", "HITL"),
            "unknown question label-triage:beads:X-1",
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

    it.each([
        [
            "AFK with HITL",
            answer("label-triage:beads:X-1:autonomy", "AFK", "HITL"),
            "invalid for autonomy: AFK with HITL",
        ],
        [
            "HITL with grill-me",
            answer("label-triage:beads:X-1:autonomy", "HITL", "grill-me"),
            "invalid for autonomy: two autonomy labels: HITL, grill-me",
        ],
        [
            "two scope labels",
            answer("label-triage:beads:X-1:scope", "work", "personal"),
            "invalid for scope: two scope labels: work, personal",
        ],
        [
            "grill-me for a scope question",
            answer("label-triage:beads:X-1:scope", "grill-me"),
            "invalid for scope: unknown label grill-me",
        ],
    ])("rejects %s after reading the task, writing nothing", async (_, given, detail) => {
        const calls: string[] = [];
        const records = await answerLabelTriage(
            [given],
            context(trackers(calls, { beads: [task("beads", "X-1", [])] })),
        );
        expect(records).toEqual([
            { id: given.id, labels: given.values, status: "rejected", detail },
        ]);
        expect(calls).toEqual(["beads:readTask:X-1"]);
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
            [answer("label-triage:beads:X-12:autonomy", "HITL")],
            context(given),
        );
        expect(records).toEqual([
            {
                id: "label-triage:beads:X-12:autonomy",
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
            "label-triage:linear:DOT-1:autonomy",
            "quota-gate:beads:X-12:autonomy",
            "label-triage:beads:X-12:autonomy",
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
            "beads:addLabel:X-12:personal",
            "beads:addLabel:X-12:AFK",
            "beads:addLabel:X-12:proposal",
            "linear:addLabel:DOT-1:HITL",
            "linear:addLabel:DOT-1:proposal",
        ]);
        expect(await labelsOf(given, "X-12")).toEqual(["bug", "personal", "AFK", "proposal"]);
    });
});
