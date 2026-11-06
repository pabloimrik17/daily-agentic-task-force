// The persist report (spec autonomous-run, "Persist report").

import type { AttemptId } from "../attempts/record.ts";
import type { Source } from "../config.ts";

export const PERSIST_SCHEMA = "autonomous.persist.v1";

interface PersistTask {
    source: Source;
    id: string;
    title: string;
}

// "existing": an earlier run posted the comment, so this one posted none.
type CommentWrite = "posted" | "existing" | "none";

export interface PersistReport {
    schema: typeof PERSIST_SCHEMA;
    startedAt: string;
    outcome: "advance" | "not-evaluable"; // advance exactly when the receipt is written
    attempt: AttemptId;
    task: PersistTask | null; // null when the task was not read
    written: { description: boolean; comment: CommentWrite };
    readBack: { description: boolean; comment: boolean };
    // What the operator should know although the persist went through, e.g. a re-serialised description.
    notes: string[];
    reasons: string[];
    receipt: string | null; // the receipt's path, once written
    // Present only when the configuration failed to load, leaving nothing to read.
    config?: { path: string; error: string };
}

export function blank(attempt: AttemptId, startedAt: Date): PersistReport {
    return {
        schema: PERSIST_SCHEMA,
        startedAt: startedAt.toISOString(),
        outcome: "not-evaluable",
        attempt,
        task: null,
        written: { description: false, comment: "none" },
        readBack: { description: false, comment: false },
        notes: [],
        reasons: [],
        receipt: null,
    };
}

// With --json a configuration that fails to load still yields one document;
// the error itself goes to stderr.
export function unconfiguredPersist(
    attempt: AttemptId,
    path: string,
    error: string,
    startedAt: Date,
): PersistReport {
    return { ...blank(attempt, startedAt), config: { path, error } };
}

export function renderPersistJson(report: PersistReport): string {
    return JSON.stringify(report, null, 2);
}

export function renderPersistText(report: PersistReport): string {
    const header = [
        `autonomous persist — started ${report.startedAt}`,
        `outcome: ${report.outcome}`,
        `attempt: ${report.attempt}`,
    ];
    if (report.config !== undefined) {
        return header.join("\n");
    }
    return [
        ...header,
        taskLine(report.task),
        `description: ${descriptionLine(report)}`,
        `comment: ${commentLine(report)}`,
        `receipt: ${report.receipt ?? "none"}`,
        ...listing("notes", report.notes),
        ...listing("reasons", report.reasons),
    ].join("\n");
}

function listing(title: string, items: readonly string[]): string[] {
    return items.length === 0 ? [] : [`${title}:`, ...items.map((item) => `  - ${item}`)];
}

function taskLine(task: PersistTask | null): string {
    return task === null ? "task: unread" : `task: ${task.source} ${task.id} → "${task.title}"`;
}

function descriptionLine({ written, readBack }: PersistReport): string {
    if (!written.description) {
        return "not written";
    }
    return readBack.description ? "written, read back" : "written, not read back";
}

function commentLine({ written, readBack }: PersistReport): string {
    if (written.comment === "none") {
        return "not posted";
    }
    const posted = written.comment === "posted" ? "posted" : "already posted";
    return readBack.comment ? `${posted}, found` : `${posted}, not found`;
}
