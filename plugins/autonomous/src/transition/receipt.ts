// The transition waits for the persistence receipt, and for a code review's publish receipt (spec
// autonomous-run). The attempts are read without the run lock: the checks only read, and a receipt
// that appears while they run can only make them pass.

import { access, readFile } from "node:fs/promises";
import { join } from "node:path";

import { type AttemptId, type AttemptRecord, holdsTask, type TaskRef } from "../attempts/record.ts";
import { attemptDir, listRecords, receiptPath } from "../attempts/state.ts";
import {
    digestOf,
    FINDINGS_FILE,
    PUBLISH_RECEIPT_FILE,
    readPublishReceipt,
} from "../publish/receipt.ts";
import type { Result } from "../result.ts";
import type { TransitionStage } from "./mode.ts";

interface AwaitedReceipt {
    stage: TransitionStage;
    attempt: AttemptId;
    receipt: string;
}

// What persist mode saves for an attempt of the stage.
const PERSISTED: Record<TransitionStage, string> = {
    "grill-me": "definition",
    proposal: "stage summary",
    implement: "stage summary",
    verify: "stage summary",
    "code-review": "stage summary",
};

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

async function openAttempts(
    state: string,
    ref: TaskRef,
    stage: TransitionStage,
): Promise<Result<AttemptId[]>> {
    let records: AttemptRecord[];
    try {
        records = await listRecords(state);
    } catch (error) {
        return { ok: false, error: messageOf(error) };
    }
    const open = records.filter(
        (record) =>
            record.task.source === ref.source &&
            record.task.id === ref.id &&
            record.stage === stage &&
            holdsTask(record),
    );
    return { ok: true, value: open.map(({ id }) => id) };
}

async function awaitedReceipt(
    state: string,
    ref: TaskRef,
    stage: TransitionStage,
): Promise<Result<AwaitedReceipt | null>> {
    const open = await openAttempts(state, ref, stage);
    if (!open.ok) {
        return open;
    }
    for (const id of open.value) {
        const receipt = receiptPath(attemptDir(state, id));
        if (!(await exists(receipt))) {
            return { ok: true, value: { stage, attempt: id, receipt } };
        }
    }
    return { ok: true, value: null };
}

function awaitedDetail({ stage, attempt, receipt }: AwaitedReceipt): string {
    return `${stage} attempt ${attempt} has no persistence receipt at ${receipt}; persist its ${PERSISTED[stage]} with --apply --persist ${attempt}, or discard the attempt`;
}

async function exists(file: string): Promise<boolean> {
    try {
        await access(file);
        return true;
    } catch {
        return false;
    }
}

async function awaitedPublish(
    state: string,
    ref: TaskRef,
    stage: TransitionStage,
): Promise<Result<string | null>> {
    if (stage !== "code-review") {
        return { ok: true, value: null };
    }
    const open = await openAttempts(state, ref, stage);
    if (!open.ok) {
        return open;
    }
    for (const id of open.value) {
        const dir = attemptDir(state, id);
        const receipt = await readPublishReceipt(dir);
        if (!receipt.ok) {
            return receipt;
        }
        const detail = await unpublished(id, dir, receipt.value?.findingsDigest ?? null);
        if (detail !== null) {
            return { ok: true, value: detail };
        }
    }
    return { ok: true, value: null };
}

async function unpublished(
    attempt: AttemptId,
    dir: string,
    published: string | null,
): Promise<string | null> {
    const publish = `publish it with --apply --publish ${attempt}`;
    if (published === null) {
        const file = join(dir, PUBLISH_RECEIPT_FILE);
        return `code-review attempt ${attempt} has no publish receipt at ${file}, so its record is not published; ${publish}, or discard the attempt`;
    }
    let current: string | null = null;
    try {
        current = digestOf(await readFile(join(dir, FINDINGS_FILE)));
    } catch {
        // a record that cannot be read differs from the one published
    }
    return current === published
        ? null
        : `code-review attempt ${attempt} has a ${FINDINGS_FILE} that differs from the one published, so its record is not published; ${publish}, or discard the attempt`;
}

export async function awaitedDetails(
    state: string,
    ref: TaskRef,
    stage: TransitionStage,
): Promise<Result<string | null>> {
    const persisted = await awaitedReceipt(state, ref, stage);
    if (!persisted.ok) {
        return persisted;
    }
    if (persisted.value !== null) {
        return { ok: true, value: awaitedDetail(persisted.value) };
    }
    return awaitedPublish(state, ref, stage);
}
