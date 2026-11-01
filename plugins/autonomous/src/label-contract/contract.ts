// The label contract (spec label-contract): the fixed set of labels, their
// grouping, colours and meanings, shared by detection, triage and bootstrap.

// The label values are declared once here; every other type and list of
// labels is derived from these.
const SCOPE_LABELS = ["work", "personal"] as const;
const AUTONOMY_LABELS = ["AFK", "HITL"] as const;
const STAGE_LABELS = ["grill-me", "proposal"] as const;
const TAKEN_LABEL = "taken";

export type Scope = (typeof SCOPE_LABELS)[number];
export type AutonomyLabel = (typeof AUTONOMY_LABELS)[number];
export type StageLabel = (typeof STAGE_LABELS)[number];
export type ContractLabel = Scope | AutonomyLabel | StageLabel | typeof TAKEN_LABEL;

export type Group = "scope" | "autonomy" | "stage";
// The groups a decision is made for; the stage follows the autonomy (design D2, D3).
export type DecidedGroup = "scope" | "autonomy";
// `grill-me` as an autonomy decision means "decide the autonomy in a grill".
export type AutonomyDecision = AutonomyLabel | "grill-me";

export const LABELS: readonly ContractLabel[] = [
    ...SCOPE_LABELS,
    ...AUTONOMY_LABELS,
    ...STAGE_LABELS,
    TAKEN_LABEL,
];

export const GROUPS: Record<Group, readonly ContractLabel[]> = {
    scope: SCOPE_LABELS,
    autonomy: AUTONOMY_LABELS,
    stage: STAGE_LABELS,
};

export const DECIDED_GROUPS: readonly DecidedGroup[] = ["scope", "autonomy"];

export const COLOURS: Record<ContractLabel, string> = {
    AFK: "#5e6ad2",
    HITL: "#eb5757",
    "grill-me": "#f2994a",
    proposal: "#bb87fc",
    work: "#2f80ed",
    personal: "#27ae60",
    taken: "#95a2b3",
};

export const MEANINGS: Record<ContractLabel, string> = {
    work: "Nazaries work.",
    personal: "The user's own work.",
    AFK: "An agent may advance the task without a human.",
    HITL: "An agent may advance the task, but a human intervenes during or at the end of each stage.",
    "grill-me": "The task must be refined with a human in a grill before anyone works on it.",
    proposal:
        "The task is ready for proposal preparation, its autonomy decided and any grill it needed over.",
    taken: "An agent or a person is advancing the task now; it is not selected until the label is removed.",
};

export function isContractLabel(name: string): name is ContractLabel {
    return (LABELS as readonly string[]).includes(name);
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

// Every group holds exactly one label on a task (spec "Three label groups").
export function isValidGroup(group: Group, labels: readonly string[]): boolean {
    return (
        labels.length === 1 &&
        labels.every((label) => (GROUPS[group] as readonly string[]).includes(label))
    );
}

// Design D2: the options of a decision for a task with these labels. `grill-me` is an
// autonomy option only while the task has no stage label.
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
