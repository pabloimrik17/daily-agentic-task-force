// The registered stages (spec stage-sessions, "Stage contract"; design D6):
// what `launch` consults. A stage selected but absent here is reported as
// waiting for an implementation.

import { grillMeStage } from "./grill-me/stage.ts";
import type { Stage, StageId } from "./stage.ts";
import { testStage } from "./test.ts";

export const STAGES: ReadonlyMap<StageId, Stage> = new Map([
    [testStage.id, testStage],
    [grillMeStage.id, grillMeStage],
]);

export function stageFor(id: StageId): Stage | undefined {
    return STAGES.get(id);
}
