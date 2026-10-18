// The registered stages (spec stage-sessions, "Stage contract"; design D6):
// what `launch` consults. A stage selected but absent here is reported as
// waiting for an implementation.

import type { Stage, StageId } from "./stage.ts";
import { testStage } from "./test.ts";

// DOT-110 registers grill-me here.
export const STAGES: ReadonlyMap<StageId, Stage> = new Map([[testStage.id, testStage]]);

export function stageFor(id: StageId): Stage | undefined {
    return STAGES.get(id);
}
