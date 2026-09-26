// Deriving labels by rule (spec label-triage, "Derive labels by rule first"):
// a missing group is resolved from its own evidence alone, before any
// judgement is requested. A valid set of evidence labels yields a derivation
// with confidence 1; a conflicting set is reported to the human instead.

import type { Source } from "../config.ts";
import { type Detection, type Evidence } from "../label-contract/detect.ts";
import { type Group, GROUPS, isValidGroup } from "../label-contract/contract.ts";

export type Tier = "code" | "llm";

export interface Derivation {
    source: Source;
    taskId: string;
    title: string;
    group: Group;
    labels: string[]; // what was derived (validity checked in decide)
    confidence: number; // rules: 1
    reason: string; // rules: the evidence detail(s); llm: the model's one sentence
    tier: Tier;
}

export function deriveByRule(detection: Detection): { derived: Derivation[]; asked: Derivation[] } {
    const derived: Derivation[] = [];
    const asked: Derivation[] = [];
    for (const group of Object.keys(GROUPS) as Group[]) {
        const state = detection.groups[group];
        if (state.status !== "missing" || state.evidence.length === 0) {
            continue;
        }
        const derivation = deriveGroup(detection, group, state.evidence);
        if (isValidGroup(group, derivation.labels)) {
            derived.push(derivation);
        } else {
            asked.push({
                ...derivation,
                confidence: 0,
                reason: `conflicting evidence: ${derivation.reason}`,
            });
        }
    }
    return { derived, asked };
}

function deriveGroup(detection: Detection, group: Group, evidence: Evidence[]): Derivation {
    const labels: string[] = [];
    for (const item of evidence) {
        if (!labels.includes(item.label)) {
            labels.push(item.label);
        }
    }
    return {
        source: detection.task.source,
        taskId: detection.task.id,
        title: detection.task.title,
        group,
        labels,
        confidence: 1,
        reason: evidence.map((item) => item.detail).join("; "),
        tier: "code",
    };
}
