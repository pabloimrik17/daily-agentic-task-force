// Ordering, capping and confidence-threshold decisions (spec label-triage,
// "Derive labels by rule first" and "Confidence threshold per group"):
// deterministic for a given input so the report is reproducible, and
// validity is checked before the confidence threshold.

import {
    DECIDED_GROUPS,
    GROUPS,
    type Group,
    isStageLabel,
    isValidDecision,
    TRIAGE_LABEL,
} from "../label-contract/contract.ts";
import type { Detection } from "../label-contract/detect.ts";
import type { Derivation } from "./rules.ts";
import type { TriageRecord } from "./write.ts";

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

// A marked task is already left for the human: it is neither judged nor counted against the cap.
export function selectForJudgement(
    detections: Detection[],
    cap: number,
): { selected: Detection[]; remainder: number } {
    const ordered = orderForJudgement(detections.filter((detection) => !detection.marked));
    return {
        selected: ordered.slice(0, cap),
        remainder: Math.max(0, ordered.length - cap),
    };
}

export const MARKED_REASON = `carries ${TRIAGE_LABEL}: left for the human, not judged again`;

// Spec label-triage, "Questions of marked tasks": a missing scope or autonomy group of a
// marked task that no rule or alias decides is listed for the human without a judgement.
export function markedRecords(detections: readonly Detection[]): TriageRecord[] {
    return detections
        .filter((detection) => detection.marked)
        .flatMap((detection) =>
            DECIDED_GROUPS.filter((group) => {
                const state = detection.groups[group];
                return state.status === "missing" && state.evidence.length === 0;
            }).map(
                (group): TriageRecord => ({
                    source: detection.task.source,
                    taskId: detection.task.id,
                    title: detection.task.title,
                    group,
                    labels: [],
                    confidence: null,
                    reason: MARKED_REASON,
                    tier: "marked",
                    status: "asked",
                    detail: null,
                }),
            ),
        );
}

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
    // Only a `marked` record has no confidence, and it is never decided here.
    const confidence = derivation.confidence ?? 0;
    if (confidence < threshold) {
        return {
            status: "asked",
            reason: `below threshold ${threshold.toFixed(2)}: ${confidence.toFixed(2)}`,
        };
    }
    return { status: "eligible", reason: "" };
}
