// The transition table and what it answers about a task's stage.

import type { TaskRef } from "../attempts/record.ts";
import {
    type AutonomyLabel,
    GROUPS,
    isAutonomyLabel,
    type StageLabel,
} from "../label-contract/contract.ts";
import type { Result } from "../result.ts";

// The transitions (spec label-contract, "A transition replaces the stage"), keyed by the stage
// they leave; `asks` names the question that leads out of it.
type TransitionQuestion = "autonomy" | "approval";

interface TransitionTarget {
    to: StageLabel;
    asks: TransitionQuestion;
    ready: string; // what the question says about the stage it asks to leave
    persisted: string; // what persist mode saves for an attempt of the stage
    guarded: boolean; // leaving needs the work finished (./guards.ts)
}

const TRANSITIONS = {
    "grill-me": {
        to: "proposal",
        asks: "autonomy",
        ready: "the grill is over",
        persisted: "definition",
        guarded: false,
    },
    proposal: {
        to: "implement",
        asks: "approval",
        ready: "the proposal is ready",
        persisted: "stage summary",
        guarded: false,
    },
    implement: {
        to: "verify",
        asks: "approval",
        ready: "the implementation is ready",
        persisted: "stage summary",
        guarded: true,
    },
    verify: {
        to: "code-review",
        asks: "approval",
        ready: "the verification is ready",
        persisted: "stage summary",
        guarded: true,
    },
    "code-review": {
        to: "external-review",
        asks: "approval",
        ready: "the code review is ready",
        persisted: "stage summary",
        guarded: true,
    },
    "external-review": {
        to: "wrap-up",
        asks: "approval",
        ready: "the external review is ready",
        persisted: "stage summary",
        guarded: true,
    },
} as const satisfies Partial<Record<StageLabel, TransitionTarget>>;

export type TransitionStage = keyof typeof TRANSITIONS;

export interface TransitionRow extends TransitionTarget {
    from: TransitionStage;
}

export function transitionRow(from: TransitionStage): TransitionRow {
    return { from, ...TRANSITIONS[from] };
}

export const TRANSITION_STAGES = Object.keys(TRANSITIONS) as TransitionStage[];

export function isTransitionStage(value: string): value is TransitionStage {
    return (TRANSITION_STAGES as readonly string[]).includes(value);
}

// Table order: a task a cut-short transition left with grill-me beside proposal is still in
// grill-me, so answering again completes that transition.
export function rowOf(labels: readonly string[]): TransitionRow | null {
    const from = TRANSITION_STAGES.find((stage) => labels.includes(stage));
    return from === undefined ? null : transitionRow(from);
}

// An autonomy answers the way out of grill-me; the next stage approves the way out of the others.
export function accepts(row: TransitionRow, value: string): boolean {
    return row.asks === "autonomy" ? isAutonomyLabel(value) : value === row.to;
}

export const AUTONOMY_OPTIONS: readonly AutonomyLabel[] = GROUPS.autonomy.filter(isAutonomyLabel);

// What an approval answers with: the stage each approval row leads to.
export const APPROVAL_VALUES: readonly StageLabel[] = TRANSITION_STAGES.map(transitionRow)
    .filter((row) => row.asks === "approval")
    .map((row) => row.to);

// The autonomy that decides how a task leaves a stage left on approval, `proposal`, `implement`, `verify`,
// `code-review` or `external-review` (spec label-contract, "The autonomy decides whether leaving ... needs an answer"): exactly one,
// or the reason there is none.
export function stageAutonomy(
    ref: TaskRef,
    labels: readonly string[],
    stage: TransitionStage,
): Result<AutonomyLabel> {
    const found = labels.filter(isAutonomyLabel);
    const [only] = found;
    if (found.length === 1 && only !== undefined) {
        return { ok: true, value: only };
    }
    const expected = `expected one of ${AUTONOMY_OPTIONS.join(", ")}`;
    const problem =
        found.length === 0 ? "has no autonomy" : `has conflicting autonomy [${found.join(", ")}]`;
    return { ok: false, error: `${ref.source} ${ref.id} in ${stage} ${problem}: ${expected}` };
}
