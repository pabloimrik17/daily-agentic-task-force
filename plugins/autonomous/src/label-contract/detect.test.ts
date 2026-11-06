import type { SourceRules } from "../config.ts";
import type { TrackerTask } from "../label-triage/trackers/tracker.ts";
import { describe, expect, it } from "vitest";

import { detect, isComplete } from "./detect.ts";

const rules = (overrides: Partial<SourceRules> = {}): SourceRules => ({
    enabled: true,
    ...overrides,
});

const task = (labels: string[], overrides: Partial<TrackerTask> = {}): TrackerTask => ({
    source: "beads",
    id: "bd-1",
    title: "A task",
    description: null,
    labels,
    status: "open",
    updatedAt: "",
    ...overrides,
});

// Spec label-contract, "Three label groups": one test per scenario.
describe("detect: three label groups", () => {
    it("Complete task: personal, AFK and proposal are complete for all three groups", () => {
        const detection = detect(task(["personal", "AFK", "proposal"]), rules());
        expect(detection.groups).toEqual({
            scope: { status: "present", labels: ["personal"] },
            autonomy: { status: "present", labels: ["AFK"] },
            stage: { status: "present", labels: ["proposal"] },
        });
        expect(Object.values(detection.groups).every(isComplete)).toBe(true);
    });

    it("Grill without autonomy: personal and grill-me are complete, autonomy deferred, not missing", () => {
        const detection = detect(task(["personal", "grill-me"]), rules());
        expect(detection.groups).toEqual({
            scope: { status: "present", labels: ["personal"] },
            autonomy: { status: "deferred" },
            stage: { status: "present", labels: ["grill-me"] },
        });
        expect(Object.values(detection.groups).every(isComplete)).toBe(true);
    });

    it("Grill with a decided autonomy: work, HITL and grill-me are complete for all three groups", () => {
        const detection = detect(task(["work", "HITL", "grill-me"]), rules());
        expect(detection.groups).toEqual({
            scope: { status: "present", labels: ["work"] },
            autonomy: { status: "present", labels: ["HITL"] },
            stage: { status: "present", labels: ["grill-me"] },
        });
        expect(Object.values(detection.groups).every(isComplete)).toBe(true);
    });

    it("Missing entry group: work alone is untagged for autonomy and for stage", () => {
        const detection = detect(task(["work"]), rules());
        expect(detection.groups).toEqual({
            scope: { status: "present", labels: ["work"] },
            autonomy: { status: "missing", evidence: [] },
            stage: { status: "missing", evidence: [] },
        });
    });

    it("Missing stage: work and AFK are untagged for the stage group only", () => {
        const detection = detect(task(["work", "AFK"]), rules());
        expect(detection.groups).toEqual({
            scope: { status: "present", labels: ["work"] },
            autonomy: { status: "present", labels: ["AFK"] },
            stage: { status: "missing", evidence: [] },
        });
    });

    it("Missing autonomy outside a grill: personal and proposal are untagged for autonomy only", () => {
        const detection = detect(task(["personal", "proposal"]), rules());
        expect(detection.groups).toEqual({
            scope: { status: "present", labels: ["personal"] },
            autonomy: { status: "missing", evidence: [] },
            stage: { status: "present", labels: ["proposal"] },
        });
    });

    it("Both scopes: work and personal are a scope conflict and neither label is removed", () => {
        const labels = ["work", "personal"];
        const detection = detect(task(labels), rules());
        expect(detection.groups.scope).toEqual({
            status: "conflict",
            labels: ["work", "personal"],
        });
        expect(detection.task.labels).toEqual(["work", "personal"]);
    });

    it("AFK with HITL: an autonomy conflict for a human to resolve", () => {
        const detection = detect(task(["AFK", "HITL"]), rules());
        expect(detection.groups.autonomy).toEqual({ status: "conflict", labels: ["AFK", "HITL"] });
        expect(isComplete(detection.groups.autonomy)).toBe(false);
    });

    it("Two stages: grill-me and proposal are a stage conflict for a human to resolve", () => {
        const detection = detect(task(["grill-me", "proposal"]), rules());
        expect(detection.groups.stage).toEqual({
            status: "conflict",
            labels: ["grill-me", "proposal"],
        });
        expect(isComplete(detection.groups.stage)).toBe(false);
    });
});

describe("detect", () => {
    it("does not defer the autonomy of a task with two stage labels", () => {
        const detection = detect(task(["work", "grill-me", "proposal"]), rules());
        expect(detection.groups.autonomy).toEqual({ status: "missing", evidence: [] });
    });

    it("does not defer an autonomy in conflict while in grill-me", () => {
        const detection = detect(task(["AFK", "HITL", "grill-me"]), rules());
        expect(detection.groups.autonomy).toEqual({ status: "conflict", labels: ["AFK", "HITL"] });
    });

    it("leaves taken out of every group when a task carries it", () => {
        const detection = detect(task(["work", "AFK", "proposal", "taken"]), rules());
        expect(detection.groups).toEqual({
            scope: { status: "present", labels: ["work"] },
            autonomy: { status: "present", labels: ["AFK"] },
            stage: { status: "present", labels: ["proposal"] },
        });
    });

    it("does not treat a near-miss spelling as the contract label", () => {
        const detection = detect(task(["Grill Me"], { source: "linear" }), rules());
        expect(detection.groups.stage).toEqual({ status: "missing", evidence: [] });
    });

    it("does not treat Proposal as proposal", () => {
        const detection = detect(task(["Proposal"]), rules());
        expect(detection.groups.stage).toEqual({ status: "missing", evidence: [] });
    });

    it("records alias evidence for a missing group without treating the alias as present", () => {
        const detection = detect(task(["nazaries"]), rules({ aliases: { work: ["nazaries"] } }));
        expect(detection.groups.scope).toEqual({
            status: "missing",
            evidence: [{ label: "work", kind: "alias", detail: "alias nazaries" }],
        });
    });

    it("records alias evidence for an autonomy label", () => {
        const detection = detect(task(["work", "human"]), rules({ aliases: { HITL: ["human"] } }));
        expect(detection.groups.autonomy).toEqual({
            status: "missing",
            evidence: [{ label: "HITL", kind: "alias", detail: "alias human" }],
        });
    });

    it("records a grill-me alias as stage evidence and, with no stage label, as autonomy evidence", () => {
        const detection = detect(
            task(["Grill Me"], { source: "linear" }),
            rules({ aliases: { "grill-me": ["Grill Me"] } }),
        );
        const evidence = [{ label: "grill-me", kind: "alias", detail: "alias Grill Me" }];
        expect(detection.groups.stage).toEqual({ status: "missing", evidence });
        expect(detection.groups.autonomy).toEqual({ status: "missing", evidence });
    });

    it("does not record a grill-me alias as autonomy evidence once the task has a stage label", () => {
        const detection = detect(
            task(["Grill Me", "proposal"], { source: "linear" }),
            rules({ aliases: { "grill-me": ["Grill Me"] } }),
        );
        expect(detection.groups.autonomy).toEqual({ status: "missing", evidence: [] });
    });

    it("records structural evidence for every task of a source with a configured scope", () => {
        const detection = detect(task([], { source: "linear" }), rules({ scope: "personal" }));
        expect(detection.groups.scope).toEqual({
            status: "missing",
            evidence: [
                { label: "personal", kind: "structural", detail: "every linear task is personal" },
            ],
        });
    });

    it("produces evidence only for a missing group, not a present or conflicting one", () => {
        const detection = detect(
            task(["work", "personal", "human"]),
            rules({ aliases: { work: ["nazaries"], HITL: ["human"] } }),
        );
        expect(detection.groups.scope).toEqual({
            status: "conflict",
            labels: ["work", "personal"],
        });
    });

    it("produces no evidence for a deferred autonomy", () => {
        const detection = detect(
            task(["work", "grill-me", "human"]),
            rules({ aliases: { HITL: ["human"] } }),
        );
        expect(detection.groups.autonomy).toEqual({ status: "deferred" });
    });

    it("records both alias and structural evidence for the same label as two entries", () => {
        const detection = detect(
            task(["nazaries"], { source: "beads" }),
            rules({ scope: "work", aliases: { work: ["nazaries"] } }),
        );
        expect(detection.groups.scope).toEqual({
            status: "missing",
            evidence: [
                { label: "work", kind: "alias", detail: "alias nazaries" },
                { label: "work", kind: "structural", detail: "every beads task is work" },
            ],
        });
    });

    it("reports a task with no labels at all as missing every group", () => {
        const detection = detect(task([]), rules());
        expect(detection.groups).toEqual({
            scope: { status: "missing", evidence: [] },
            autonomy: { status: "missing", evidence: [] },
            stage: { status: "missing", evidence: [] },
        });
    });
});

describe("isComplete", () => {
    it("counts present and deferred as complete, missing and conflict as not", () => {
        expect(isComplete({ status: "present", labels: ["work"] })).toBe(true);
        expect(isComplete({ status: "deferred" })).toBe(true);
        expect(isComplete({ status: "missing", evidence: [] })).toBe(false);
        expect(isComplete({ status: "conflict", labels: ["AFK", "HITL"] })).toBe(false);
    });
});
