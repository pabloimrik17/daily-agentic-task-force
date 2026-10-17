// The next stage of a task (design D4). When DOT-110 adds stage labels, it
// replaces `nextStage`'s body with a read of the stage label and extends
// `SUPPORTED_STAGES` once the proposal stage runs; nothing else depends on how
// the stage is derived.

import type { StageName } from "./types.ts";

const SUPPORTED_STAGES: readonly StageName[] = ["grill-me"];

export function nextStage(labels: readonly string[]): StageName {
    return labels.includes("grill-me") ? "grill-me" : "proposal";
}

export function isSupported(stage: StageName): boolean {
    return SUPPORTED_STAGES.includes(stage);
}
