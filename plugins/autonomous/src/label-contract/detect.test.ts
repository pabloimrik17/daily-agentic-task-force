import type { SourceRules } from "../config.ts";
import type { TrackerTask } from "../label-triage/trackers/tracker.ts";
import { describe, expect, it } from "vitest";

import { detect } from "./detect.ts";

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

describe("detect", () => {
    it("reports both groups present for personal + AFK", () => {
        const detection = detect(task(["personal", "AFK"]), rules());
        expect(detection.groups.scope).toEqual({ status: "present", labels: ["personal"] });
        expect(detection.groups.entry).toEqual({ status: "present", labels: ["AFK"] });
    });

    it("reports the entry group untagged when only scope is present", () => {
        const detection = detect(task(["work"]), rules());
        expect(detection.groups.scope).toEqual({ status: "present", labels: ["work"] });
        expect(detection.groups.entry).toEqual({ status: "missing", evidence: [] });
    });

    it("reports a scope conflict for work + personal, neither removed", () => {
        const detection = detect(task(["work", "personal"]), rules());
        expect(detection.groups.scope).toEqual({
            status: "conflict",
            labels: ["work", "personal"],
        });
    });

    it("reports an entry conflict for AFK + HITL", () => {
        const detection = detect(task(["AFK", "HITL"]), rules());
        expect(detection.groups.entry).toEqual({ status: "conflict", labels: ["AFK", "HITL"] });
    });

    it("accepts AFK + grill-me as a valid, non-conflicting entry set", () => {
        const detection = detect(task(["AFK", "grill-me"]), rules());
        expect(detection.groups.entry).toEqual({
            status: "present",
            labels: ["AFK", "grill-me"],
        });
    });

    it("does not treat a near-miss spelling as the contract label", () => {
        const detection = detect(task(["Grill Me"]), rules());
        expect(detection.groups.entry).toEqual({ status: "missing", evidence: [] });
    });

    it("records alias evidence for a missing group without treating the alias as present", () => {
        const detection = detect(task(["nazaries"]), rules({ aliases: { work: ["nazaries"] } }));
        expect(detection.groups.scope).toEqual({
            status: "missing",
            evidence: [{ label: "work", kind: "alias", detail: "alias nazaries" }],
        });
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
            task(["work", "personal"]),
            rules({ aliases: { work: ["nazaries"] } }),
        );
        expect(detection.groups.scope).toEqual({
            status: "conflict",
            labels: ["work", "personal"],
        });
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

    it("reports a task with no labels at all as missing both groups", () => {
        const detection = detect(task([]), rules());
        expect(detection.groups.scope).toEqual({ status: "missing", evidence: [] });
        expect(detection.groups.entry).toEqual({ status: "missing", evidence: [] });
    });
});
