// The label contract (spec label-contract): the fixed set of labels, their
// grouping, colours and meanings, shared by detection, triage and bootstrap.

// The label values are declared once here; every other type and list of
// labels is derived from these.
const SCOPE_LABELS = ["work", "personal"] as const;
const AUTONOMY_LABELS = ["AFK", "HITL"] as const;
const STAGE_LABELS = ["grill-me", "proposal", "implement"] as const;
export const TAKEN_LABEL = "taken";
export const TRIAGE_LABEL = "triage-me";
// The labels outside every group: never required, never missing, never in conflict,
// and never given an alias.
const UNGROUPED_LABELS = [TAKEN_LABEL, TRIAGE_LABEL] as const;

export type Scope = (typeof SCOPE_LABELS)[number];
export type AutonomyLabel = (typeof AUTONOMY_LABELS)[number];
export type StageLabel = (typeof STAGE_LABELS)[number];
export type UngroupedLabel = (typeof UNGROUPED_LABELS)[number];
export type ContractLabel = Scope | AutonomyLabel | StageLabel | UngroupedLabel;

export type Group = "scope" | "autonomy" | "stage";
// The stage is left out: it follows the autonomy.
export type DecidedGroup = "scope" | "autonomy";
// `grill-me` as an autonomy decision means "decide the autonomy in a grill".
export type AutonomyDecision = AutonomyLabel | "grill-me";

export const LABELS: readonly ContractLabel[] = [
    ...SCOPE_LABELS,
    ...AUTONOMY_LABELS,
    ...STAGE_LABELS,
    ...UNGROUPED_LABELS,
];

export const GROUPS: Record<Group, readonly ContractLabel[]> = {
    scope: SCOPE_LABELS,
    autonomy: AUTONOMY_LABELS,
    stage: STAGE_LABELS,
};

// From the earliest stage to the most advanced.
export const STAGE_ORDER: readonly StageLabel[] = STAGE_LABELS;

export const DECIDED_GROUPS: readonly DecidedGroup[] = ["scope", "autonomy"];

export const COLOURS: Record<ContractLabel, string> = {
    AFK: "#5e6ad2",
    HITL: "#eb5757",
    "grill-me": "#f2994a",
    proposal: "#bb87fc",
    implement: "#26b5ce",
    work: "#2f80ed",
    personal: "#27ae60",
    taken: "#95a2b3",
    "triage-me": "#f2c94c",
};

export const MEANINGS: Record<ContractLabel, string> = {
    work: "Nazaries work.",
    personal: "The user's own work.",
    AFK: "An agent may advance the task without a human.",
    HITL: "An agent may advance the task, but a human intervenes during or at the end of each stage.",
    "grill-me": "The task must be refined with a human in a grill before anyone works on it.",
    proposal:
        "The task is ready for proposal preparation, its autonomy decided and any grill it needed over.",
    implement: "The task has a proposal and is ready to implement.",
    taken: "An agent or a person is advancing the task now; it is not selected until the label is removed.",
    "triage-me":
        "The task's scope or autonomy could not be decided without the human; it is neither judged again nor selected until the label is removed.",
};

export function isContractLabel(name: string): name is ContractLabel {
    return (LABELS as readonly string[]).includes(name);
}

export function isUngroupedLabel(name: string): name is UngroupedLabel {
    return (UNGROUPED_LABELS as readonly string[]).includes(name);
}

export function isScope(value: string): value is Scope {
    return (SCOPE_LABELS as readonly string[]).includes(value);
}

export function isAutonomyLabel(value: string): value is AutonomyLabel {
    return (AUTONOMY_LABELS as readonly string[]).includes(value);
}

export function isStageLabel(value: string): value is StageLabel {
    return (STAGE_LABELS as readonly string[]).includes(value);
}

export function hasStageLabel(taskLabels: readonly string[]): boolean {
    return taskLabels.some(isStageLabel);
}

export function isValidGroup(group: Group, labels: readonly string[]): boolean {
    return (
        labels.length === 1 &&
        labels.every((label) => (GROUPS[group] as readonly string[]).includes(label))
    );
}

export function optionsFor(
    group: DecidedGroup,
    taskLabels: readonly string[],
): readonly (Scope | AutonomyDecision)[] {
    if (group === "scope") {
        return SCOPE_LABELS;
    }
    return hasStageLabel(taskLabels) ? AUTONOMY_LABELS : [...AUTONOMY_LABELS, "grill-me"];
}

export function isValidDecision(
    group: Group,
    labels: readonly string[],
    taskLabels: readonly string[],
): boolean {
    if (group === "stage") {
        return isValidGroup(group, labels);
    }
    const [label] = labels;
    return (
        labels.length === 1 &&
        label !== undefined &&
        (optionsFor(group, taskLabels) as readonly string[]).includes(label)
    );
}
