import type { AttemptId } from "../attempts/record.ts";
import type { Source } from "../config.ts";

export const LOG_SCHEMA = "autonomous.log.v1";

interface LogTask {
    source: Source;
    id: string;
    title: string;
}

interface LogPullRequest {
    number: number;
    url: string;
}

// "existing": an earlier run published the entry, so this one published none.
type EntryWrite = "published" | "existing" | "none";

export interface LogReport {
    schema: typeof LOG_SCHEMA;
    startedAt: string;
    outcome: "advance" | "not-evaluable"; // advance exactly when the receipt is written or already there
    attempt: AttemptId;
    task: LogTask | null;
    pullRequest: LogPullRequest | null;
    entry: EntryWrite;
    words: number | null;
    // What the operator should know although the entry went through.
    notes: string[];
    reasons: string[];
    receipt: string | null;
    config?: { path: string; error: string };
}

export function blankLog(attempt: AttemptId, startedAt: Date): LogReport {
    return {
        schema: LOG_SCHEMA,
        startedAt: startedAt.toISOString(),
        outcome: "not-evaluable",
        attempt,
        task: null,
        pullRequest: null,
        entry: "none",
        words: null,
        notes: [],
        reasons: [],
        receipt: null,
    };
}

export function unconfiguredLog(
    attempt: AttemptId,
    path: string,
    error: string,
    startedAt: Date,
): LogReport {
    return { ...blankLog(attempt, startedAt), config: { path, error } };
}

export function renderLogJson(report: LogReport): string {
    return JSON.stringify(report, null, 2);
}

export function renderLogText(report: LogReport): string {
    const header = [
        `autonomous log — started ${report.startedAt}`,
        `outcome: ${report.outcome}`,
        `attempt: ${report.attempt}`,
    ];
    if (report.config !== undefined) {
        return header.join("\n");
    }
    return [
        ...header,
        report.task === null
            ? "task: unread"
            : `task: ${report.task.source} ${report.task.id} → "${report.task.title}"`,
        report.pullRequest === null
            ? "pull request: none"
            : `pull request: #${report.pullRequest.number} ${report.pullRequest.url}`,
        `body: ${report.words === null ? "unread" : `${report.words} words`}`,
        `entry: ${ENTRY_LINES[report.entry]}`,
        `receipt: ${report.receipt ?? "none"}`,
        ...section("notes", report.notes),
        ...section("reasons", report.reasons),
    ].join("\n");
}

const ENTRY_LINES: Record<EntryWrite, string> = {
    published: "published",
    existing: "already published",
    none: "not published",
};

function section(title: string, items: readonly string[]): string[] {
    return items.length === 0 ? [] : [`${title}:`, ...items.map((item) => `  - ${item}`)];
}
