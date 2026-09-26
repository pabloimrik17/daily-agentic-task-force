import { describe, expect, it } from "vitest";

import type { Detection, Evidence, GroupState } from "../label-contract/detect.ts";
import { decide, orderForJudgement, selectForJudgement } from "./decide.ts";
import type { Derivation } from "./rules.ts";
import type { TrackerTask } from "./trackers/tracker.ts";

const task = (overrides: Partial<TrackerTask> = {}): TrackerTask => ({
    source: "beads",
    id: "bd-1",
    title: "A task",
    description: null,
    labels: [],
    status: "open",
    updatedAt: "",
    ...overrides,
});

const missing = (evidence: Evidence[] = []): GroupState => ({ status: "missing", evidence });

const detection = (
    overrides: Partial<TrackerTask> = {},
    scope: GroupState = missing(),
): Detection => ({
    task: task(overrides),
    groups: { scope, entry: missing() },
});

const derivation = (overrides: Partial<Derivation> = {}): Derivation => ({
    source: "beads",
    taskId: "bd-1",
    title: "A task",
    group: "scope",
    labels: ["work"],
    confidence: 1,
    reason: "alias nazaries",
    tier: "code",
    ...overrides,
});

describe("decide", () => {
    it("is eligible when confidence is at or above the threshold and the labels are valid", () => {
        expect(decide(derivation({ confidence: 1 }), 0.95)).toEqual({
            status: "eligible",
            reason: "",
        });
    });

    it("asks when confidence is below the threshold", () => {
        expect(decide(derivation({ confidence: 0.8 }), 0.95)).toEqual({
            status: "asked",
            reason: "below threshold 0.95: 0.80",
        });
    });

    it("asks a confident but invalid judgement, AFK with HITL, before checking the threshold", () => {
        expect(
            decide(derivation({ group: "entry", labels: ["AFK", "HITL"], confidence: 0.99 }), 0.95),
        ).toEqual({
            status: "asked",
            reason: "invalid under the contract: AFK with HITL",
        });
    });

    it("asks with the unknown label named when a label is outside the vocabulary", () => {
        expect(decide(derivation({ group: "entry", labels: ["not-a-label"] }), 0.95)).toEqual({
            status: "asked",
            reason: "invalid under the contract: unknown label not-a-label",
        });
    });

    it("asks naming both scope labels when a group carries two", () => {
        expect(decide(derivation({ labels: ["work", "personal"] }), 0.95)).toEqual({
            status: "asked",
            reason: "invalid under the contract: two scope labels: work, personal",
        });
    });

    it("asks when a group carries no label", () => {
        expect(decide(derivation({ labels: [] }), 0.95)).toEqual({
            status: "asked",
            reason: "invalid under the contract: no label",
        });
    });
});

describe("orderForJudgement", () => {
    it("orders tasks with work evidence in a missing scope group first", () => {
        const withWork = detection(
            { id: "b", updatedAt: "2024-01-01T00:00:00Z" },
            missing([{ label: "work", kind: "alias", detail: "alias nazaries" }]),
        );
        const withoutWork = detection({ id: "a", updatedAt: "2024-06-01T00:00:00Z" });
        const ordered = orderForJudgement([withoutWork, withWork]);
        expect(ordered.map((d) => d.task.id)).toEqual(["b", "a"]);
    });

    it("orders tasks that already carry work first", () => {
        const labelledWork = detection(
            { id: "b", labels: ["work"], updatedAt: "2024-01-01T00:00:00Z" },
            { status: "present", labels: ["work"] },
        );
        const labelledPersonal = detection(
            { id: "c", labels: ["personal"], updatedAt: "2024-06-01T00:00:00Z" },
            { status: "present", labels: ["personal"] },
        );
        const withoutWork = detection({ id: "a", updatedAt: "2024-06-01T00:00:00Z" });
        const ordered = orderForJudgement([labelledPersonal, withoutWork, labelledWork]);
        expect(ordered.map((d) => d.task.id)).toEqual(["b", "a", "c"]);
    });

    it("orders by updatedAt descending, then id ascending, empty updatedAt sorting last", () => {
        const older = detection({ id: "x", updatedAt: "2024-01-01T00:00:00Z" });
        const newer = detection({ id: "y", updatedAt: "2024-06-01T00:00:00Z" });
        const unknown = detection({ id: "z", updatedAt: "" });
        const tie1 = detection({ id: "b", updatedAt: "2024-01-01T00:00:00Z" });
        const tie2 = detection({ id: "a", updatedAt: "2024-01-01T00:00:00Z" });
        const ordered = orderForJudgement([older, newer, unknown, tie1, tie2]);
        expect(ordered.map((d) => d.task.id)).toEqual(["y", "a", "b", "x", "z"]);
    });

    it("compares updatedAt as instants across formats, unparsable values sorting last", () => {
        const whole = detection({ id: "a", updatedAt: "2024-06-01T10:00:02Z" });
        const fraction = detection({ id: "b", updatedAt: "2024-06-01T10:00:02.123Z" });
        const offset = detection({ id: "c", updatedAt: "2024-06-01T12:00:00+02:00" });
        const earlier = detection({ id: "d", updatedAt: "2024-06-01T10:00:01Z" });
        const unparsable = detection({ id: "e", updatedAt: "not a date" });
        const empty = detection({ id: "f", updatedAt: "" });
        const ordered = orderForJudgement([empty, offset, unparsable, whole, earlier, fraction]);
        expect(ordered.map((d) => d.task.id)).toEqual(["b", "a", "d", "c", "e", "f"]);
    });

    it("does not mutate the input array", () => {
        const a = detection({ id: "a", updatedAt: "2024-01-01T00:00:00Z" });
        const b = detection({ id: "b", updatedAt: "2024-06-01T00:00:00Z" });
        const input = [a, b];
        orderForJudgement(input);
        expect(input).toEqual([a, b]);
    });
});

describe("selectForJudgement", () => {
    it("selects up to the cap, taking the deterministic order, and reports the remainder", () => {
        const detections = Array.from({ length: 60 }, (_, i) =>
            detection({ id: `t-${String(i).padStart(2, "0")}`, updatedAt: "2024-01-01T00:00:00Z" }),
        );
        const { selected, remainder } = selectForJudgement(detections, 25);
        expect(selected.length).toBe(25);
        expect(remainder).toBe(35);
        expect(selected.map((d) => d.task.id)).toEqual(
            Array.from({ length: 25 }, (_, i) => `t-${String(i).padStart(2, "0")}`),
        );
    });

    it("reports a remainder of 0 when the cap is not reached", () => {
        const detections = [detection({ id: "a" }), detection({ id: "b" })];
        const { selected, remainder } = selectForJudgement(detections, 25);
        expect(selected.length).toBe(2);
        expect(remainder).toBe(0);
    });

    it("selects nothing with a cap of 0", () => {
        const detections = [detection({ id: "a" }), detection({ id: "b" })];
        const { selected, remainder } = selectForJudgement(detections, 0);
        expect(selected).toEqual([]);
        expect(remainder).toBe(2);
    });
});
