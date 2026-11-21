// The registered stages (spec stage-sessions, "Stage contract"; design D6):
// what `launch` consults. A stage selected but absent here is reported as
// waiting for an implementation.

import { grillMeStage } from "./grill-me/stage.ts";
import { implementStage } from "./implement/stage.ts";
import { proposalStage } from "./proposal/stage.ts";
import type { Stage, StageId } from "./stage.ts";
import { testStage } from "./test.ts";
import { verifyStage } from "./verify/stage.ts";

export const STAGES: ReadonlyMap<StageId, Stage> = new Map([
    [testStage.id, testStage],
    [grillMeStage.id, grillMeStage],
    [proposalStage.id, proposalStage],
    [implementStage.id, implementStage],
    [verifyStage.id, verifyStage],
]);

export function stageFor(id: StageId): Stage | undefined {
    return STAGES.get(id);
}
