// Per-group presence, missing and conflict detection (spec label-contract):
// exact spelling decides presence; aliases and structural scope rules only
// ever produce evidence for a group that is MISSING, and are never resolved
// by the system removing or replacing a label.

import type { ContractLabel, SourceRules } from "../config.ts";
import type { TrackerTask } from "../label-triage/trackers/tracker.ts";
import { GROUPS, type Group, isContractLabel, isValidGroup, optionsFor } from "./contract.ts";

export interface Evidence {
    label: ContractLabel;
    kind: "alias" | "structural";
    detail: string; // `alias nazaries` | `every linear task is personal`
}

// `deferred` (design D1): autonomy only, when the task has no autonomy label and its
// only stage label is `grill-me`; the grill decides it.
export type GroupState =
    | { status: "present"; labels: ContractLabel[] }
    | { status: "missing"; evidence: Evidence[] }
    | { status: "conflict"; labels: ContractLabel[] }
    | { status: "deferred" };

export interface Detection {
    task: TrackerTask;
    groups: Record<Group, GroupState>;
}

export function detect(task: TrackerTask, rules: SourceRules): Detection {
    const present = task.labels.filter(isContractLabel);
    return {
        task,
        groups: {
            scope: groupState("scope", present, task, rules),
            autonomy: isDeferred(present)
                ? { status: "deferred" }
                : groupState("autonomy", present, task, rules),
            stage: groupState("stage", present, task, rules),
        },
    };
}

// Consumers count a deferred autonomy as complete, with no special case (design D1).
export function isComplete(state: GroupState): boolean {
    return state.status === "present" || state.status === "deferred";
}

function isDeferred(present: ContractLabel[]): boolean {
    const stage = labelsOf("stage", present);
    return (
        labelsOf("autonomy", present).length === 0 && stage.length === 1 && stage[0] === "grill-me"
    );
}

function labelsOf(group: Group, present: ContractLabel[]): ContractLabel[] {
    return present.filter((label) => GROUPS[group].includes(label));
}

function groupState(
    group: Group,
    present: ContractLabel[],
    task: TrackerTask,
    rules: SourceRules,
): GroupState {
    const labels = labelsOf(group, present);
    if (labels.length === 0) {
        return { status: "missing", evidence: evidenceFor(group, task, rules) };
    }
    if (isValidGroup(group, labels)) {
        return { status: "present", labels };
    }
    return { status: "conflict", labels };
}

// The labels a group's evidence may name. An autonomy decision may be `grill-me` while
// the task has no stage label (design D2), so an alias for `grill-me` is also evidence
// for the autonomy decision; the stage then follows it (design D3).
function evidenceLabels(group: Group, task: TrackerTask): ContractLabel[] {
    return group === "autonomy"
        ? optionsFor(group, task.labels).filter(isContractLabel)
        : [...GROUPS[group]];
}

function evidenceFor(group: Group, task: TrackerTask, rules: SourceRules): Evidence[] {
    const evidence: Evidence[] = [];
    for (const label of evidenceLabels(group, task)) {
        const aliases = rules.aliases?.[label] ?? [];
        for (const alias of aliases) {
            if (task.labels.includes(alias)) {
                evidence.push({ label, kind: "alias", detail: `alias ${alias}` });
            }
        }
    }
    if (group === "scope" && rules.scope !== undefined) {
        evidence.push({
            label: rules.scope,
            kind: "structural",
            detail: `every ${task.source} task is ${rules.scope}`,
        });
    }
    return evidence;
}
