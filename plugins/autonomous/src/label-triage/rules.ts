// Deriving labels by rule (spec label-triage, "Derive labels by rule first" and
// "The stage follows the autonomy"): a missing scope or autonomy is resolved
// from its own evidence alone, before any judgement is requested. A valid set
// of evidence labels yields a derivation with confidence 1; a conflicting set
// is reported to the human instead. The stage is never derived from evidence:
// it follows the autonomy (design D3).

import type { Source } from "../config.ts";
import { type Detection, type Evidence } from "../label-contract/detect.ts";
import {
    DECIDED_GROUPS,
    type DecidedGroup,
    type Group,
    hasStageLabel,
    isAutonomyLabel,
    isValidDecision,
} from "../label-contract/contract.ts";

// `human`: an answer to a question of the handoff, applied in answer mode; no triage
// report renders it.
export type Tier = "code" | "llm" | "human";

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
    for (const group of DECIDED_GROUPS) {
        const state = detection.groups[group];
        if (state.status !== "missing" || state.evidence.length === 0) {
            continue;
        }
        const derivation = deriveGroup(detection, group, state.evidence);
        if (isValidDecision(group, derivation.labels, detection.task.labels)) {
            derived.push(derivation);
        } else {
            asked.push({
                ...derivation,
                confidence: 0,
                reason: `conflicting evidence: ${derivation.reason}`,
            });
        }
    }
    const stage = stageFromAutonomy(detection);
    if (stage !== undefined) {
        derived.push(stage);
    }
    return { derived, asked };
}

// Design D3: the derivations an eligible autonomy decision writes, in write order.
// `grill-me` is recorded in the stage group alone; `AFK` or `HITL` brings `proposal`
// while the task has no stage label. A decision of another group is returned as is.
export function recordsForAutonomy(
    decision: Derivation,
    taskLabels: readonly string[],
): Derivation[] {
    const [label] = decision.labels;
    if (label === "grill-me") {
        return [{ ...decision, group: "stage" }];
    }
    if (label === undefined || !isAutonomyLabel(label) || hasStageLabel(taskLabels)) {
        return [decision];
    }
    return [
        decision,
        {
            ...decision,
            group: "stage",
            labels: ["proposal"],
            confidence: 1,
            reason: `follows autonomy ${label}`,
            tier: "code",
        },
    ];
}

// A task that carries an autonomy label and no stage label gets `proposal` by rule.
function stageFromAutonomy(detection: Detection): Derivation | undefined {
    const autonomy = detection.groups.autonomy;
    if (detection.groups.stage.status !== "missing" || autonomy.status !== "present") {
        return undefined;
    }
    return {
        ...taskFields(detection),
        group: "stage",
        labels: ["proposal"],
        confidence: 1,
        reason: `autonomy ${autonomy.labels.join(", ")} is present`,
        tier: "code",
    };
}

function deriveGroup(detection: Detection, group: DecidedGroup, evidence: Evidence[]): Derivation {
    const labels: string[] = [];
    for (const item of evidence) {
        if (!labels.includes(item.label)) {
            labels.push(item.label);
        }
    }
    return {
        ...taskFields(detection),
        group,
        labels,
        confidence: 1,
        reason: evidence.map((item) => item.detail).join("; "),
        tier: "code",
    };
}

function taskFields(detection: Detection): Pick<Derivation, "source" | "taskId" | "title"> {
    return {
        source: detection.task.source,
        taskId: detection.task.id,
        title: detection.task.title,
    };
}
