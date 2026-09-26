// Ordering, capping and confidence-threshold decisions (spec label-triage,
// "Derive labels by rule first" and "Confidence threshold per group"):
// deterministic for a given input so the report is reproducible, and
// validity is checked before the confidence threshold.

import { GROUPS, type Group, isValidGroup } from "../label-contract/contract.ts";
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

export function orderForJudgement(detections: Detection[]): Detection[] {
    return [...detections].sort((a, b) => {
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
    });
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

function violation(group: Group, labels: string[]): string {
    if (labels.length === 0) {
        return "no label";
    }
    const allowed = GROUPS[group] as readonly string[];
    const unknown = labels.find((label) => !allowed.includes(label));
    if (unknown !== undefined) {
        return `unknown label ${unknown}`;
    }
    if (group === "scope") {
        return `two scope labels: ${labels.join(", ")}`;
    }
    return "AFK with HITL";
}

export function decide(
    derivation: Derivation,
    threshold: number,
): { status: "eligible" | "asked"; reason: string } {
    if (!isValidGroup(derivation.group, derivation.labels)) {
        return {
            status: "asked",
            reason: `invalid under the contract: ${violation(derivation.group, derivation.labels)}`,
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
