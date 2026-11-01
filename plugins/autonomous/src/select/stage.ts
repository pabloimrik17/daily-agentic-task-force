// A task without exactly one stage label has no next stage, and selection excludes it under
// classification before it asks. `SUPPORTED_STAGES` grows once the proposal stage runs.

import { isStageLabel } from "../label-contract/contract.ts";
import type { StageName } from "./types.ts";

const SUPPORTED_STAGES: readonly StageName[] = ["grill-me"];

export function nextStage(labels: readonly string[]): StageName | null {
    const [stage, ...rest] = labels.filter(isStageLabel);
    return stage !== undefined && rest.length === 0 ? stage : null;
}

export function isSupported(stage: StageName): boolean {
    return SUPPORTED_STAGES.includes(stage);
}
