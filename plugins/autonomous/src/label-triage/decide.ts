// Ordering, capping and confidence-threshold decisions (spec label-triage,
// "Derive labels by rule first" and "Confidence threshold per group"):
// deterministic for a given input so the report is reproducible, and
// validity is checked before the confidence threshold.

import { GROUPS, type Group, isStageLabel, isValidDecision } from "../label-contract/contract.ts";
import type { Detection } from "../label-contract/detect.ts";
import type { Derivation } from "./rules.ts";

// A task already labelled `work` keeps its priority once its scope group is written.
function hasWorkEvidence(detection: Detection): boolean {
    const scope = detection.groups.scope;
    if (scope.status === "present") {
        return scope.labels.includes("work");
    }
    return scope.status === "missing" && scope.evidence.some((item) => item.label === "work");
}

// Trackers format timestamps differently (fractions, offsets), so they are compared as
// instants; an empty or unparsable one sorts last.
function updatedAtMs(detection: Detection): number {
    const ms = Date.parse(detection.task.updatedAt);
    return Number.isNaN(ms) ? -Infinity : ms;
}

// Work evidence first, then the most recently updated, then by id. Also orders the
// step's questions for the human (handoff design D4).
export function compareForJudgement(a: Detection, b: Detection): number {
    const workRank = (d: Detection) => (hasWorkEvidence(d) ? 0 : 1);
    const rankDiff = workRank(a) - workRank(b);
    if (rankDiff !== 0) {
        return rankDiff;
    }
    const aMs = updatedAtMs(a);
    const bMs = updatedAtMs(b);
    if (aMs !== bMs) {
        return aMs < bMs ? 1 : -1;
    }
    if (a.task.id !== b.task.id) {
        return a.task.id < b.task.id ? -1 : 1;
    }
    return 0;
}

export function orderForJudgement(detections: Detection[]): Detection[] {
    return [...detections].sort(compareForJudgement);
}

export function selectForJudgement(
    detections: Detection[],
    cap: number,
): { selected: Detection[]; remainder: number } {
    const ordered = orderForJudgement(detections);
    return {
        selected: ordered.slice(0, cap),
        remainder: Math.max(0, ordered.length - cap),
    };
}

// Why a group's labels are invalid under the contract for a task with these labels. The
// autonomy vocabulary includes `grill-me`, an autonomy decision.
export function violation(
    group: Group,
    labels: readonly string[],
    taskLabels: readonly string[],
): string {
    if (labels.length === 0) {
        return "no label";
    }
    const vocabulary: readonly string[] =
        group === "autonomy" ? [...GROUPS.autonomy, "grill-me"] : GROUPS[group];
    const unknown = labels.find((label) => !vocabulary.includes(label));
    if (unknown !== undefined) {
        return `unknown label ${unknown}`;
    }
    if (group !== "autonomy") {
        return `two ${group} labels: ${labels.join(", ")}`;
    }
    return autonomyViolation(labels, taskLabels);
}

function autonomyViolation(labels: readonly string[], taskLabels: readonly string[]): string {
    if (labels.includes("AFK") && labels.includes("HITL")) {
        return "AFK with HITL";
    }
    if (labels.length > 1) {
        return `two autonomy labels: ${labels.join(", ")}`;
    }
    return `grill-me with a stage label: ${taskLabels.filter(isStageLabel).join(", ")}`;
}

export function decide(
    derivation: Derivation,
    threshold: number,
    taskLabels: readonly string[],
): { status: "eligible" | "asked"; reason: string } {
    if (!isValidDecision(derivation.group, derivation.labels, taskLabels)) {
        return {
            status: "asked",
            reason: `invalid under the contract: ${violation(derivation.group, derivation.labels, taskLabels)}`,
        };
    }
    if (derivation.confidence < threshold) {
        return {
            status: "asked",
            reason: `below threshold ${threshold.toFixed(2)}: ${derivation.confidence.toFixed(2)}`,
        };
    }
    return { status: "eligible", reason: "" };
}
