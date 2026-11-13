import type { AttemptId } from "../attempts/record.ts";
import type { Source } from "../config.ts";

export const PULL_REQUEST_SCHEMA = "autonomous.pull-request.v1";

interface PullRequestTask {
    source: Source;
    id: string;
    title: string;
}

// "reused": the branch already had an open pull request, so none was opened.
interface ReportedPullRequest {
    number: number;
    url: string;
    title: string;
    action: "opened" | "reused";
}

export interface PullRequestReport {
    schema: typeof PULL_REQUEST_SCHEMA;
    startedAt: string;
    // advance when a pull request is reported or the task needs none (spec autonomous-run, "Pull-request mode").
    outcome: "advance" | "not-evaluable";
    attempt: AttemptId;
    task: PullRequestTask | null; // null when the task was not read
    branch: string | null; // the attempt's workspace branch
    base: string | null; // the repository's default branch; null when it was not read
    needed: boolean; // false only for the parent of a split with nothing to show (design D3)
    pullRequest: ReportedPullRequest | null;
    emptyCommit: boolean;
    reasons: string[];
    // Present only when the configuration failed to load, leaving nothing to read.
    config?: { path: string; error: string };
}

export function blankPullRequest(attempt: AttemptId, startedAt: Date): PullRequestReport {
    return {
        schema: PULL_REQUEST_SCHEMA,
        startedAt: startedAt.toISOString(),
        outcome: "not-evaluable",
        attempt,
        task: null,
        branch: null,
        base: null,
        needed: true,
        pullRequest: null,
        emptyCommit: false,
        reasons: [],
    };
}

// With --json a configuration that fails to load still yields one document;
// the error itself goes to stderr.
export function unconfiguredPullRequest(
    attempt: AttemptId,
    path: string,
    error: string,
    startedAt: Date,
): PullRequestReport {
    return { ...blankPullRequest(attempt, startedAt), config: { path, error } };
}

export function renderPullRequestJson(report: PullRequestReport): string {
    return JSON.stringify(report, null, 2);
}

export function renderPullRequestText(report: PullRequestReport): string {
    const header = [
        `autonomous pull-request — started ${report.startedAt}`,
        `outcome: ${report.outcome}`,
        `attempt: ${report.attempt}`,
    ];
    if (report.config !== undefined) {
        return header.join("\n");
    }
    return [
        ...header,
        taskLine(report.task),
        `branch: ${report.branch ?? "unread"}`,
        `base: ${report.base ?? "unread"}`,
        ...pullRequestLines(report),
        `empty commit: ${report.emptyCommit ? "added" : "none"}`,
        ...listing("reasons", report.reasons),
    ].join("\n");
}

function listing(title: string, items: readonly string[]): string[] {
    return items.length === 0 ? [] : [`${title}:`, ...items.map((item) => `  - ${item}`)];
}

function taskLine(task: PullRequestTask | null): string {
    return task === null ? "task: unread" : `task: ${task.source} ${task.id} → "${task.title}"`;
}

function pullRequestLines({ pullRequest, needed }: PullRequestReport): string[] {
    if (pullRequest === null) {
        return [`pull request: ${needed ? "none" : "not needed"}`];
    }
    const { number, url, title, action } = pullRequest;
    return [`pull request: #${number} ${action}, ${url}`, `title: "${title}"`];
}
