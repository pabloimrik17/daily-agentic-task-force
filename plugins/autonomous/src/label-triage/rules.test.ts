import { describe, expect, it } from "vitest";

import type { ContractLabel } from "../config.ts";
import type { Detection, Evidence, GroupState } from "../label-contract/detect.ts";
import type { TrackerTask } from "./trackers/tracker.ts";
import { deriveByRule } from "./rules.ts";

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

const present = (labels: ContractLabel[]): GroupState => ({ status: "present", labels });
const missing = (evidence: Evidence[]): GroupState => ({ status: "missing", evidence });

const detection = (
    scope: GroupState,
    entry: GroupState,
    overrides: Partial<TrackerTask> = {},
): Detection => ({
    task: task(overrides),
    groups: { scope, entry },
});

describe("deriveByRule", () => {
    it("derives a label from a structural rule alone", () => {
        const result = deriveByRule(
            detection(
                missing([
                    {
                        label: "personal",
                        kind: "structural",
                        detail: "every linear task is personal",
                    },
                ]),
                missing([]),
                { source: "linear" },
            ),
        );
        expect(result.derived).toEqual([
            {
                source: "linear",
                taskId: "bd-1",
                title: "A task",
                group: "scope",
                labels: ["personal"],
                confidence: 1,
                reason: "every linear task is personal",
                tier: "code",
            },
        ]);
        expect(result.asked).toEqual([]);
    });

    it("derives a label from an alias alone", () => {
        const result = deriveByRule(
            detection(
                missing([{ label: "work", kind: "alias", detail: "alias nazaries" }]),
                missing([]),
            ),
        );
        expect(result.derived).toEqual([
            expect.objectContaining({ group: "scope", labels: ["work"], reason: "alias nazaries" }),
        ]);
    });

    it("joins alias and structural evidence for the same label into one reason", () => {
        const result = deriveByRule(
            detection(
                missing([
                    { label: "work", kind: "alias", detail: "alias nazaries" },
                    { label: "work", kind: "structural", detail: "every beads task is work" },
                ]),
                missing([]),
            ),
        );
        expect(result.derived).toEqual([
            expect.objectContaining({
                labels: ["work"],
                reason: "alias nazaries; every beads task is work",
            }),
        ]);
    });

    it("derives nothing for a group with no evidence", () => {
        const result = deriveByRule(detection(missing([]), missing([])));
        expect(result.derived).toEqual([]);
        expect(result.asked).toEqual([]);
    });

    it("asks for conflicting evidence naming both details, with confidence 0", () => {
        const result = deriveByRule(
            detection(
                missing([
                    { label: "work", kind: "alias", detail: "alias nazaries" },
                    {
                        label: "personal",
                        kind: "structural",
                        detail: "every beads task is personal",
                    },
                ]),
                missing([]),
            ),
        );
        expect(result.derived).toEqual([]);
        expect(result.asked).toEqual([
            expect.objectContaining({
                group: "scope",
                labels: ["work", "personal"],
                confidence: 0,
                reason: "conflicting evidence: alias nazaries; every beads task is personal",
            }),
        ]);
    });

    it("derives HITL for an entry-group alias", () => {
        const result = deriveByRule(
            detection(
                missing([]),
                missing([{ label: "HITL", kind: "alias", detail: "alias human" }]),
            ),
        );
        expect(result.derived).toEqual([
            expect.objectContaining({ group: "entry", labels: ["HITL"], reason: "alias human" }),
        ]);
    });

    it("ignores a present group even when it also carries evidence-shaped state", () => {
        const result = deriveByRule(detection(present(["work"]), missing([])));
        expect(result.derived).toEqual([]);
        expect(result.asked).toEqual([]);
    });
});
