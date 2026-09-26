// Per-group presence, missing and conflict detection (spec label-contract):
// exact spelling decides presence; aliases and structural scope rules only
// ever produce evidence for a group that is MISSING, and are never resolved
// by the system removing or replacing a label.

import type { ContractLabel, SourceRules } from "../config.ts";
import type { TrackerTask } from "../label-triage/trackers/tracker.ts";
import { GROUPS, type Group, isContractLabel, isValidGroup } from "./contract.ts";

export interface Evidence {
    label: ContractLabel;
    kind: "alias" | "structural";
    detail: string; // `alias nazaries` | `every linear task is personal`
}

export type GroupState =
    | { status: "present"; labels: ContractLabel[] }
    | { status: "missing"; evidence: Evidence[] }
    | { status: "conflict"; labels: ContractLabel[] };

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
            entry: groupState("entry", present, task, rules),
        },
    };
}

function groupState(
    group: Group,
    present: ContractLabel[],
    task: TrackerTask,
    rules: SourceRules,
): GroupState {
    const labels = present.filter((label) => GROUPS[group].includes(label));
    if (labels.length === 0) {
        return { status: "missing", evidence: evidenceFor(group, task, rules) };
    }
    if (isValidGroup(group, labels)) {
        return { status: "present", labels };
    }
    return { status: "conflict", labels };
}

function evidenceFor(group: Group, task: TrackerTask, rules: SourceRules): Evidence[] {
    const evidence: Evidence[] = [];
    const groupLabels = GROUPS[group];
    for (const label of groupLabels) {
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
