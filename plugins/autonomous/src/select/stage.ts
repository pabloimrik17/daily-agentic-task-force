// A task without exactly one stage label has no next stage, and selection excludes it under
// classification before it asks. `verify` is a stage label with no stage behind it yet.

import { isStageLabel, STAGE_ORDER } from "../label-contract/contract.ts";
import type { StageName } from "./types.ts";

const SUPPORTED_STAGES: readonly StageName[] = ["grill-me", "proposal", "implement"];

export function nextStage(labels: readonly string[]): StageName | null {
    const [stage, ...rest] = labels.filter(isStageLabel);
    return stage !== undefined && rest.length === 0 ? stage : null;
}

export function isSupported(stage: StageName): boolean {
    return SUPPORTED_STAGES.includes(stage);
}

export interface StageSplit<T extends { stage: StageName }> {
    kept: T[]; // the candidates at the most advanced stage, in their order
    setAside: T[]; // every other candidate, in their order
}

export function splitByStage<T extends { stage: StageName }>(
    candidates: readonly T[],
): StageSplit<T> {
    const top = Math.max(...candidates.map(({ stage }) => STAGE_ORDER.indexOf(stage)));
    const kept = candidates.filter(({ stage }) => STAGE_ORDER.indexOf(stage) === top);
    return { kept, setAside: candidates.filter((candidate) => !kept.includes(candidate)) };
}
