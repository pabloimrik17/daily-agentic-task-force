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

export function holdingReason({ id, state, pendingCleanup }: HoldingAttempt): string {
    return `attempt ${id} is ${pendingCleanup ? `${state} with a pending cleanup` : state}`;
}
