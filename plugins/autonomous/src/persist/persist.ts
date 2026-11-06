// Persist mode (spec grill-me-stage, "Definition layout", "Stage summary comment", "Persistence
// is read back and leaves a receipt"). It writes a new file beside the attempt record and never
// the record, so it takes no run lock. Every step is safe to repeat: the splice replaces the
// definition and the comment is skipped once its header exists.

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { type AttemptId, type AttemptRecord, holdsTask } from "../attempts/record.ts";
import {
    attemptDir,
    definitionPath,
    readRecord,
    receiptPath,
    recordPath,
    stageSummaryPath,
    writeJsonAtomic,
} from "../attempts/state.ts";
import type { AutonomousConfig } from "../config.ts";
import type { Tracker, Trackers } from "../label-triage/trackers/tracker.ts";
import { READ_BACK_TRIES, readUntil } from "../read-back.ts";
import type { Result } from "../result.ts";
import type { StageId } from "../stages/stage.ts";
import { sameBytes, sameText } from "./compare.ts";
import { blank, type PersistReport } from "./report.ts";
import { spliceDefinition } from "./splice.ts";

export const RECEIPT_SCHEMA = "autonomous.persisted.v1";

const GRILL_ME: StageId = "grill-me";

const DESCRIPTION_FILE = "description.md";
const DESCRIPTION_READ_FILE = "description.read.md"; // what the tracker returned, when it differs
const COMMENT_FILE = "comment.md";

export interface PersistDeps {
    config: AutonomousConfig;
    trackers: Trackers;
    state: string; // where the attempt is read and its files are written, without the run lock
}

interface Ready {
    record: AttemptRecord;
    dir: string;
    definition: string;
    summary: string;
}

type Checked = { ok: true; value: Ready } | { ok: false; reasons: string[] };

interface Persisting extends Ready {
    tracker: Tracker;
    header: string;
    report: PersistReport;
    current: string | null; // the description as the tracker holds it before the splice
}

// A step returns the reason it failed, or null when it did its part.
type PersistStep = (persisting: Persisting) => Promise<string | null>;

const STEPS: readonly PersistStep[] = [readTask, saveDescription, saveComment, writeReceipt];

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

// The first line of the comment, which tells this attempt's apart from any other.
export function headerOf(attempt: AttemptId): string {
    return `autonomous · ${GRILL_ME} · ${attempt} · definition saved`;
}

export async function runPersist(
    attempt: AttemptId,
    deps: PersistDeps,
    startedAt: Date,
): Promise<PersistReport> {
    const report = blank(attempt, startedAt);
    const checked = await check(attempt, deps);
    if (!checked.ok) {
        return { ...report, reasons: checked.reasons };
    }
    const persisting: Persisting = {
        ...checked.value,
        tracker: deps.trackers[checked.value.record.task.source],
        header: headerOf(attempt),
        report,
        current: null,
    };
    for (const step of STEPS) {
        const failure = await step(persisting);
        if (failure !== null) {
            report.reasons.push(failure);
            return report;
        }
    }
    report.outcome = "advance";
    return report;
}

// Spec autonomous-run, "Persist preconditions": nothing is written before every one holds.
async function check(attempt: AttemptId, deps: PersistDeps): Promise<Checked> {
    const dir = attemptDir(deps.state, attempt);
    const found = await findRecord(attempt, dir);
    if (!found.ok) {
        return { ok: false, reasons: [found.error] };
    }
    const { value: record } = found;
    const refusal = refuse(record, deps.config);
    if (refusal !== null) {
        return { ok: false, reasons: [refusal] };
    }
    const [definition, summary] = await Promise.all([
        readDocument(definitionPath(dir)),
        readDocument(stageSummaryPath(dir)),
    ]);
    if (!definition.ok || !summary.ok) {
        const reasons = [definition, summary].flatMap((read) => (read.ok ? [] : [read.error]));
        return { ok: false, reasons };
    }
    return {
        ok: true,
        value: { record, dir, definition: definition.value, summary: summary.value },
    };
}

async function findRecord(attempt: AttemptId, dir: string): Promise<Result<AttemptRecord>> {
    try {
        return { ok: true, value: await readRecord(recordPath(dir)) };
    } catch (error) {
        const missing = (error as { cause?: NodeJS.ErrnoException }).cause?.code === "ENOENT";
        return {
            ok: false,
            error: missing
                ? `unknown attempt ${attempt}: no record at ${recordPath(dir)}`
                : messageOf(error),
        };
    }
}

function refuse(record: AttemptRecord, config: AutonomousConfig): string | null {
    if (!holdsTask(record)) {
        return `attempt ${record.id} is ${record.state}, not open`;
    }
    if (record.stage !== GRILL_ME) {
        return `attempt ${record.id} is a ${record.stage} attempt: persist mode takes only ${GRILL_ME} attempts`;
    }
    const { source } = record.task;
    return config.sources[source].enabled ? null : `${source} is not enabled`;
}

async function readDocument(file: string): Promise<Result<string>> {
    let text: string;
    try {
        text = await readFile(file, "utf8");
    } catch (error) {
        const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
        return {
            ok: false,
            error: missing ? `${file} is missing` : `cannot read ${file}: ${messageOf(error)}`,
        };
    }
    return text.trim() === ""
        ? { ok: false, error: `${file} is empty` }
        : { ok: true, value: text };
}

async function writeText(file: string, text: string): Promise<string | null> {
    try {
        await writeFile(file, text);
        return null;
    } catch (error) {
        return `cannot write ${file}: ${messageOf(error)}`;
    }
}

// Fresh, right before the splice: a description edited while the grill ran is what is spliced.
async function readTask(persisting: Persisting): Promise<string | null> {
    const read = await persisting.tracker.readTask(persisting.record.task.id);
    if (!read.ok) {
        return read.error;
    }
    const { source, id, title, description } = read.value;
    persisting.report.task = { source, id, title };
    persisting.current = description;
    return null;
}

async function saveDescription(persisting: Persisting): Promise<string | null> {
    const { tracker, record, dir, report } = persisting;
    const next = spliceDefinition(persisting.current, persisting.definition);
    const file = join(dir, DESCRIPTION_FILE);
    const failed = await writeText(file, next);
    if (failed !== null) {
        return failed;
    }
    const updated = await tracker.updateDescription(record.task.id, file);
    if (!updated.ok) {
        return updated.error;
    }
    report.written.description = true;
    const back = await readUntil(
        () => tracker.readTask(record.task.id),
        (read) => sameText(next, read.description),
    );
    if (!back.ok) {
        return back.error;
    }
    return checkReadBack(persisting, next, back.value.description);
}

// The read-back confirms the text landed, not that the Markdown is byte-identical.
async function checkReadBack(
    persisting: Persisting,
    written: string,
    read: string | null,
): Promise<string | null> {
    const { record, dir, report } = persisting;
    if (sameBytes(written, read)) {
        report.readBack.description = true;
        return null;
    }
    const file = join(dir, DESCRIPTION_READ_FILE);
    const failed = await writeText(file, read ?? "");
    if (failed !== null) {
        return failed;
    }
    const task = `${record.task.source} ${record.task.id}`;
    if (!sameText(written, read)) {
        return `${task}: the description read back differs from the one written (${READ_BACK_TRIES}); what the tracker returned is at ${file}`;
    }
    report.readBack.description = true;
    report.notes.push(
        `${task}: the tracker re-serialised the description; its text matches what was written, and what it returned is at ${file}`,
    );
    return null;
}

function hasHeader(comments: readonly string[], header: string): boolean {
    return comments.some((body) => body.trimStart().split("\n", 1)[0]?.trimEnd() === header);
}

async function saveComment(persisting: Persisting): Promise<string | null> {
    const { tracker, record, header, report } = persisting;
    const listed = await tracker.readComments(record.task.id);
    if (!listed.ok) {
        return listed.error;
    }
    if (hasHeader(listed.value, header)) {
        report.written.comment = "existing";
        report.readBack.comment = true;
        return null;
    }
    return (await postComment(persisting)) ?? (await confirmComment(persisting));
}

async function postComment(persisting: Persisting): Promise<string | null> {
    const { tracker, record, dir, header, summary, report } = persisting;
    const file = join(dir, COMMENT_FILE);
    const failed = await writeText(file, `${header}\n\n${summary}`);
    if (failed !== null) {
        return failed;
    }
    const added = await tracker.addComment(record.task.id, file);
    if (!added.ok) {
        return added.error;
    }
    report.written.comment = "posted";
    return null;
}

async function confirmComment(persisting: Persisting): Promise<string | null> {
    const { tracker, record, header, report } = persisting;
    const back = await readUntil(
        () => tracker.readComments(record.task.id),
        (comments) => hasHeader(comments, header),
    );
    if (!back.ok) {
        return back.error;
    }
    if (!hasHeader(back.value, header)) {
        return `${record.task.source} ${record.task.id}: the comment headed "${header}" was not found when read back (${READ_BACK_TRIES})`;
    }
    report.readBack.comment = true;
    return null;
}

async function writeReceipt(persisting: Persisting): Promise<string | null> {
    const { record, dir, header, report } = persisting;
    const file = receiptPath(dir);
    const { source, id } = record.task;
    try {
        await writeJsonAtomic(file, {
            schema: RECEIPT_SCHEMA,
            attempt: record.id,
            task: { source, id },
            at: report.startedAt,
            header,
        });
    } catch (error) {
        return `cannot write the receipt ${file}: ${messageOf(error)}`;
    }
    report.receipt = file;
    return null;
}
