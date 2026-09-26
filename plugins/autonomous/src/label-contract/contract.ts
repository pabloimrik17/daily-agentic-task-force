// The label contract (spec label-contract): the fixed set of labels, their
// grouping, colours and meanings, shared by detection, triage and bootstrap.

import type { ContractLabel } from "../config.ts";

export type Group = "scope" | "entry";

export const LABELS: readonly ContractLabel[] = ["work", "personal", "AFK", "HITL", "grill-me"];

export const GROUPS: Record<Group, readonly ContractLabel[]> = {
    scope: ["work", "personal"],
    entry: ["AFK", "HITL", "grill-me"],
};

export const COLOURS: Record<ContractLabel, string> = {
    AFK: "#5e6ad2",
    HITL: "#eb5757",
    "grill-me": "#f2994a",
    work: "#2f80ed",
    personal: "#27ae60",
};

export const MEANINGS: Record<ContractLabel, string> = {
    work: "Nazaries work, and has priority over personal work.",
    personal: "The user's own work.",
    AFK: "An agent may advance the task without a human.",
    HITL: "An agent may advance the task, but a human intervenes during or at the end of each stage.",
    "grill-me":
        "The task must be refined with a human before anyone works on it, and it takes precedence over AFK and HITL when combined.",
};

export function isContractLabel(name: string): name is ContractLabel {
    return (LABELS as readonly string[]).includes(name);
}

export function isValidGroup(group: Group, labels: readonly string[]): boolean {
    if (group === "scope") {
        return (
            labels.length === 1 &&
            labels.every((label) => (GROUPS.scope as readonly string[]).includes(label))
        );
    }
    const allEntry = labels.every((label) => (GROUPS.entry as readonly string[]).includes(label));
    return labels.length > 0 && allEntry && !(labels.includes("AFK") && labels.includes("HITL"));
}
