// The attempt that holds a task, as data: `launch` waits on it and `select` excludes the task
// (design D2).

import type { WorkTask } from "../select/types.ts";
import { type AttemptId, type AttemptRecord, type AttemptState, holdsTask } from "./record.ts";

export interface HoldingAttempt {
    id: AttemptId;
    state: AttemptState;
    pendingCleanup: boolean; // a completed attempt holds its task until its cleanup is done
}

export function holdingAttempt(
    records: readonly AttemptRecord[],
    task: Pick<WorkTask, "source" | "id">,
): HoldingAttempt | null {
    const open = records.find(
        (record) =>
            record.task.source === task.source && record.task.id === task.id && holdsTask(record),
    );
    return open === undefined
        ? null
        : { id: open.id, state: open.state, pendingCleanup: open.cleanup !== null };
}
