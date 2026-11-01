import { describe, expect, it } from "vitest";

import type { ContractLabel, SourceRules } from "../config.ts";
import {
    detect,
    type Detection,
    type Evidence,
    type GroupState,
} from "../label-contract/detect.ts";
import type { TrackerTask } from "./trackers/tracker.ts";
import { type Derivation, deriveByRule, recordsForAutonomy } from "./rules.ts";

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
    autonomy: GroupState,
    stage: GroupState = missing([]),
    overrides: Partial<TrackerTask> = {},
): Detection => ({
    task: task(overrides),
    groups: { scope, autonomy, stage },
});

const rules = (overrides: Partial<SourceRules> = {}): SourceRules => ({
    enabled: true,
    ...overrides,
});

const decision = (overrides: Partial<Derivation> = {}): Derivation => ({
    source: "beads",
    taskId: "bd-1",
    title: "A task",
    group: "autonomy",
    labels: ["AFK"],
    confidence: 0.97,
    reason: "a small, well-specified change",
    tier: "llm",
    ...overrides,
});

// Spec label-triage, "The stage follows the autonomy": the scenarios rules alone can show.
describe("deriveByRule: the stage follows the autonomy", () => {
    it("Stage by rule: work and AFK with no stage derive proposal at confidence 1, tier code, naming AFK", () => {
        const result = deriveByRule(detect(task({ labels: ["work", "AFK"] }), rules()));
        expect(result.derived).toEqual([
            {
                source: "beads",
                taskId: "bd-1",
                title: "A task",
                group: "stage",
                labels: ["proposal"],
                confidence: 1,
                reason: "autonomy AFK is present",
                tier: "code",
            },
        ]);
        expect(result.asked).toEqual([]);
    });

    it("Stage after a rule-derived autonomy: the alias human gives HITL by rule, and proposal follows", () => {
        const labels = ["work", "human"];
        const result = deriveByRule(
            detect(task({ labels }), rules({ aliases: { HITL: ["human"] } })),
        );
        const [autonomy] = result.derived;
        expect(result.derived).toEqual([
            expect.objectContaining({
                group: "autonomy",
                labels: ["HITL"],
                confidence: 1,
                tier: "code",
            }),
        ]);
        expect(autonomy && recordsForAutonomy(autonomy, labels)).toEqual([
            autonomy,
            expect.objectContaining({
                group: "stage",
                labels: ["proposal"],
                confidence: 1,
                tier: "code",
                reason: "follows autonomy HITL",
            }),
        ]);
    });
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

    it("asks for conflicting autonomy evidence", () => {
        const result = deriveByRule(
            detection(
                present(["work"]),
                missing([
                    { label: "AFK", kind: "alias", detail: "alias auto" },
                    { label: "HITL", kind: "alias", detail: "alias human" },
                ]),
            ),
        );
        expect(result.derived).toEqual([]);
        expect(result.asked).toEqual([
            expect.objectContaining({
                group: "autonomy",
                labels: ["AFK", "HITL"],
                confidence: 0,
                reason: "conflicting evidence: alias auto; alias human",
            }),
        ]);
    });

    it("derives HITL for an autonomy alias, and no stage while the autonomy is not present", () => {
        const result = deriveByRule(
            detection(
                missing([]),
                missing([{ label: "HITL", kind: "alias", detail: "alias human" }]),
            ),
        );
        expect(result.derived).toEqual([
            expect.objectContaining({ group: "autonomy", labels: ["HITL"], reason: "alias human" }),
        ]);
    });

    it("decides grill-me by rule from its alias, and the stage follows as grill-me", () => {
        const labels = ["Grill Me"];
        const result = deriveByRule(
            detect(
                task({ source: "linear", labels }),
                rules({ scope: "personal", aliases: { "grill-me": ["Grill Me"] } }),
            ),
        );
        const autonomy = result.derived.find((derivation) => derivation.group === "autonomy");
        expect(autonomy).toEqual(
            expect.objectContaining({
                labels: ["grill-me"],
                confidence: 1,
                reason: "alias Grill Me",
                tier: "code",
            }),
        );
        expect(result.derived.some((derivation) => derivation.group === "stage")).toBe(false);
        expect(autonomy && recordsForAutonomy(autonomy, labels)).toEqual([
            { ...autonomy, group: "stage" },
        ]);
    });

    it("asks when a grill-me alias and an autonomy alias disagree", () => {
        const result = deriveByRule(
            detect(
                task({ labels: ["Grill Me", "human"] }),
                rules({ aliases: { "grill-me": ["Grill Me"], HITL: ["human"] } }),
            ),
        );
        expect(result.asked).toEqual([
            expect.objectContaining({
                group: "autonomy",
                labels: ["HITL", "grill-me"],
                confidence: 0,
                reason: "conflicting evidence: alias human; alias Grill Me",
            }),
        ]);
    });

    it("never derives the stage from stage evidence alone", () => {
        const result = deriveByRule(
            detection(
                present(["personal"]),
                missing([]),
                missing([{ label: "grill-me", kind: "alias", detail: "alias Grill Me" }]),
            ),
        );
        expect(result.derived).toEqual([]);
        expect(result.asked).toEqual([]);
    });

    it("derives no stage when the autonomy is in conflict", () => {
        const result = deriveByRule(
            detection(present(["work"]), { status: "conflict", labels: ["AFK", "HITL"] }),
        );
        expect(result.derived).toEqual([]);
    });

    it("derives nothing for a grill task whose autonomy is deferred", () => {
        const result = deriveByRule(
            detection(present(["work"]), { status: "deferred" }, present(["grill-me"])),
        );
        expect(result.derived).toEqual([]);
        expect(result.asked).toEqual([]);
    });

    it("ignores a present group even when it also carries evidence-shaped state", () => {
        const result = deriveByRule(
            detection(present(["work"]), present(["AFK"]), present(["proposal"])),
        );
        expect(result.derived).toEqual([]);
        expect(result.asked).toEqual([]);
    });
});

describe("recordsForAutonomy", () => {
    it("records a grill-me decision as a stage derivation only, keeping its tier, confidence and reason", () => {
        const grill = decision({ labels: ["grill-me"], confidence: 0.97, reason: "unclear goal" });
        expect(recordsForAutonomy(grill, ["personal"])).toEqual([
            { ...grill, group: "stage", labels: ["grill-me"], tier: "llm", confidence: 0.97 },
        ]);
    });

    it("adds proposal after AFK for a task with no stage label", () => {
        const afk = decision();
        expect(recordsForAutonomy(afk, ["work"])).toEqual([
            afk,
            {
                ...afk,
                group: "stage",
                labels: ["proposal"],
                confidence: 1,
                reason: "follows autonomy AFK",
                tier: "code",
            },
        ]);
    });

    it("adds no proposal after AFK for a task that already has a stage label", () => {
        const afk = decision();
        expect(recordsForAutonomy(afk, ["work", "proposal"])).toEqual([afk]);
    });

    it("returns a scope decision as is", () => {
        const scope = decision({ group: "scope", labels: ["work"] });
        expect(recordsForAutonomy(scope, [])).toEqual([scope]);
    });
});
