// The registered stages (spec stage-sessions, "Stage contract"; design D6):
// what `launch` consults. A stage selected but absent here is reported as
// waiting for an implementation.

import type { Stage } from "./stage.ts";
import { testStage } from "./test.ts";

// DOT-110 registers grill-me here.
export const STAGES: ReadonlyMap<string, Stage> = new Map([[testStage.id, testStage]]);

export function stageFor(id: string): Stage | undefined {
    return STAGES.get(id);
}
