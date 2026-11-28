// The publish report (spec autonomous-run, "Publish report").

import type { AttemptId } from "../attempts/record.ts";
import type { Source } from "../config.ts";

export const PUBLISH_SCHEMA = "autonomous.publish.v1";

interface PublishTask {
    source: Source;
    id: string;
    title: string;
}

interface PublishPullRequest {
    number: number;
    url: string;
}

// A finding and the thread it was posted in: its first comment's url.
export interface ThreadPost {
    finding: string;
    url: string;
}

interface PublishedReview {
    round: number;
    url: string;
}

// A review bot's request for changes a quiet round dismissed.
export interface DismissedReview {
    bot: string; // the bot's id in review.external.bots
    url: string;
}

interface PublishWalkthrough {
    outcome: "saved" | "unchanged" | "none";
    reason: string | null;
}

export interface PublishReport {
    schema: typeof PUBLISH_SCHEMA;
    startedAt: string;
    outcome: "advance" | "not-evaluable"; // advance exactly when the receipt is written
    attempt: AttemptId;
    task: PublishTask | null;
    pullRequest: PublishPullRequest | null;
    threads: {
        opened: ThreadPost[];
        answered: ThreadPost[]; // a reply posted: a state, an unpublished linked entry's outcome, or an exact match
        resolved: ThreadPost[];
        unresolved: ThreadPost[];
    };
    matches: ThreadPost[]; // the exact matches this run continued
    reviews: PublishedReview[]; // one per round whose new threads the run posted
    dismissed: DismissedReview[]; // only a quiet round of external review dismisses
    walkthrough: PublishWalkthrough | null; // null when the run stopped before it
    // What the operator should know although the run went through.
    notes: string[];
    reasons: string[];
    receipt: string | null;
    config?: { path: string; error: string };
}

export function blankPublish(attempt: AttemptId, startedAt: Date): PublishReport {
    return {
        schema: PUBLISH_SCHEMA,
        startedAt: startedAt.toISOString(),
        outcome: "not-evaluable",
        attempt,
        task: null,
        pullRequest: null,
        threads: { opened: [], answered: [], resolved: [], unresolved: [] },
        matches: [],
        reviews: [],
        dismissed: [],
        walkthrough: null,
        notes: [],
        reasons: [],
        receipt: null,
    };
}

export function unconfiguredPublish(
    attempt: AttemptId,
    path: string,
    error: string,
    startedAt: Date,
): PublishReport {
    return { ...blankPublish(attempt, startedAt), config: { path, error } };
}

export function renderPublishJson(report: PublishReport): string {
    return JSON.stringify(report, null, 2);
}

export function renderPublishText(report: PublishReport): string {
    const header = [
        `autonomous publish — started ${report.startedAt}`,
        `outcome: ${report.outcome}`,
        `attempt: ${report.attempt}`,
    ];
    if (report.config !== undefined) {
        return header.join("\n");
    }
    const { threads } = report;
    return [
        ...header,
        report.task === null
            ? "task: unread"
            : `task: ${report.task.source} ${report.task.id} → "${report.task.title}"`,
        report.pullRequest === null
            ? "pull request: none"
            : `pull request: #${report.pullRequest.number} ${report.pullRequest.url}`,
        ...posts("threads opened", threads.opened),
        ...posts("threads answered", threads.answered),
        ...posts("threads resolved", threads.resolved),
        ...posts("threads unresolved", threads.unresolved),
        ...posts("exact matches", report.matches),
        ...section(
            "reviews",
            report.reviews.map(({ round, url }) => `round ${round}: ${url}`),
        ),
        ...section(
            "reviews dismissed",
            report.dismissed.map(({ bot, url }) => `${bot}: ${url}`),
        ),
        `walkthrough: ${walkthroughLine(report.walkthrough)}`,
        `receipt: ${report.receipt ?? "none"}`,
        ...section("notes", report.notes),
        ...section("reasons", report.reasons),
    ].join("\n");
}

function walkthroughLine(walkthrough: PublishWalkthrough | null): string {
    if (walkthrough === null) {
        return "not reached";
    }
    return walkthrough.reason === null
        ? walkthrough.outcome
        : `${walkthrough.outcome} (${walkthrough.reason})`;
}

function posts(title: string, items: readonly ThreadPost[]): string[] {
    return items.length === 0
        ? [`${title}: none`]
        : section(
              title,
              items.map(({ finding, url }) => `${finding}: ${url}`),
          );
}

function section(title: string, items: readonly string[]): string[] {
    return items.length === 0 ? [] : [`${title}:`, ...items.map((item) => `  - ${item}`)];
}
