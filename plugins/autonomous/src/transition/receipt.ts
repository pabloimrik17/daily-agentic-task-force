// The transition waits for the persistence receipt (spec autonomous-run). The attempts
// are read without the run lock: the check only reads, and a receipt that appears while it runs
// can only make it pass.

import { access } from "node:fs/promises";

import { type AttemptId, type AttemptRecord, holdsTask, type TaskRef } from "../attempts/record.ts";
import { attemptDir, listRecords, receiptPath } from "../attempts/state.ts";
import type { Result } from "../result.ts";
import type { StageId } from "../stages/stage.ts";

const GRILL_ME: StageId = "grill-me";

export interface AwaitedReceipt {
    attempt: AttemptId;
    receipt: string;
}

// The first open grill-me attempt of the task whose directory holds no receipt; null when there
// is none, which includes a state directory that does not exist yet.
export async function awaitedReceipt(
    state: string,
    ref: TaskRef,
): Promise<Result<AwaitedReceipt | null>> {
    let records: AttemptRecord[];
    try {
        records = await listRecords(state);
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
    const open = records.filter(
        (record) =>
            record.task.source === ref.source &&
            record.task.id === ref.id &&
            record.stage === GRILL_ME &&
            holdsTask(record),
    );
    for (const { id } of open) {
        const receipt = receiptPath(attemptDir(state, id));
        if (!(await exists(receipt))) {
            return { ok: true, value: { attempt: id, receipt } };
        }
    }
    return { ok: true, value: null };
}

export function awaitedDetail({ attempt, receipt }: AwaitedReceipt): string {
    return `grill-me attempt ${attempt} has no persistence receipt at ${receipt}; persist its definition with --apply --persist ${attempt}, or discard the attempt`;
}

async function exists(file: string): Promise<boolean> {
    try {
        await access(file);
        return true;
    } catch {
        return false;
    }
}
