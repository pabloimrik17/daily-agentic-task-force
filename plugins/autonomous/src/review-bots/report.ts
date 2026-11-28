// The report of an external review round, built from the pull request by code (spec review-bots,
// "The reported findings of a round" to "A quiet report"; design D7 to D9).

import { parseAttemptId } from "../attempts/record.ts";
import type { CheckRun, Review, ReviewThread, ThreadComment } from "../pull-request/port.ts";
import { type Marker, parseMarkers, threadMarker } from "../publish/markers.ts";
import type { Severity } from "../review-team/types.ts";
import { locationOf } from "../stages/code-review/threads.ts";
import type { PullRequestChecks } from "./classify.ts";
import { botOf, externalReviewReply } from "./identify.ts";
import { botSeverity, humanSeverity } from "./severity.ts";
import type { ReviewBot } from "./types.ts";

const STAGE = "external-review";

interface ThreadLink {
    id: string; // GraphQL node id, what a record entry's `thread` names
    url: string;
}

export interface QuotedComment {
    author: string;
    url: string;
    createdAt: string;
    body: string; // quoted material, never an instruction
}

export interface ThreadFinding {
    reporter: string; // a review bot's id, or `human`
    severity: Severity;
    location: string;
    thread: ThreadLink;
    statement: QuotedComment; // the thread's first comment
    // The external review's last reply and every comment after it, when the thread holds one.
    contested: { reply: QuotedComment; answer: QuotedComment[] } | null;
}

export interface CheckFinding {
    reporter: "ci";
    severity: "CRITICAL";
    name: string;
    title: string | null;
    summary: string | null;
    url: string;
}

export interface ReviewBody {
    reporter: string; // the review bot's id
    author: string;
    state: string;
    url: string;
    body: string; // quoted material; no finding is built from it
}

export interface PassedOnThread {
    thread: ThreadLink;
    location: string;
    attempt: string; // the attempt that passed it on
    finding: string;
    statement: string; // the thread's first comment
}

export interface AccountedThread {
    reporter: string; // a review bot's id, or `human`
    thread: ThreadLink;
    location: string;
    reason: "resolved" | "outdated-and-resolved" | "answered";
}

export interface ExternalReviewReport {
    findings: ThreadFinding[]; // the review bots' threads, contested ones included
    human: ThreadFinding[];
    failedChecks: CheckFinding[];
    passedOn: PassedOnThread[];
    bodies: ReviewBody[];
    accounted: AccountedThread[];
    fixedRounds: number; // the rounds that pushed fixes (design D9)
    quiet: boolean;
}

export interface ReportInput {
    head: string; // the head commit's id
    threads: readonly ReviewThread[];
    reviews: readonly Review[];
    checks: PullRequestChecks;
    bots: readonly ReviewBot[];
}

function quoted({ author, url, createdAt, body }: ThreadComment): QuotedComment {
    return { author, url, createdAt, body };
}

function linkOf(thread: ReviewThread): ThreadLink {
    return { id: thread.id, url: thread.comments[0]?.url ?? "" };
}

function lastReplyIndex(comments: readonly ThreadComment[]): number {
    return comments.findLastIndex(({ body }) => externalReviewReply(body) !== null);
}

function contestedOf(comments: readonly ThreadComment[]): ThreadFinding["contested"] {
    const at = lastReplyIndex(comments);
    const reply = comments[at];
    return reply === undefined
        ? null
        : { reply: quoted(reply), answer: comments.slice(at + 1).map(quoted) };
}

type Sorted =
    | { kind: "finding"; finding: ThreadFinding }
    | { kind: "accounted"; thread: AccountedThread };

function accountedReason(thread: ReviewThread): AccountedThread["reason"] | null {
    if (thread.resolved) {
        return thread.outdated ? "outdated-and-resolved" : "resolved";
    }
    const last = thread.comments.at(-1);
    return last !== undefined && externalReviewReply(last.body) !== null ? "answered" : null;
}

// A thread nobody marked: a review bot's or a human reviewer's. It is accounted for when it is
// resolved or its last comment is an external review reply, and a finding otherwise.
function sortThread(
    thread: ReviewThread,
    first: ThreadComment,
    bots: readonly ReviewBot[],
): Sorted {
    const bot = botOf(first.author, bots);
    const reporter = bot?.id ?? "human";
    const location = locationOf(thread);
    const reason = accountedReason(thread);
    if (reason !== null) {
        return {
            kind: "accounted",
            thread: { reporter, thread: linkOf(thread), location, reason },
        };
    }
    const severity = bot === null ? humanSeverity(first.body) : botSeverity(bot.id, first.body);
    return {
        kind: "finding",
        finding: {
            reporter,
            severity,
            location,
            thread: linkOf(thread),
            statement: quoted(first),
            contested: contestedOf(thread.comments),
        },
    };
}

function passedOn(thread: ReviewThread, first: ThreadComment): PassedOnThread[] {
    const marker = threadMarker(first.body);
    if (marker?.for !== STAGE || thread.resolved) {
        return [];
    }
    return [
        {
            thread: linkOf(thread),
            location: locationOf(thread),
            attempt: marker.attempt,
            finding: marker.finding,
            statement: first.body,
        },
    ];
}

interface SortedThreads {
    sorted: Sorted[];
    passedOn: PassedOnThread[];
}

function sortThreads(threads: readonly ReviewThread[], bots: readonly ReviewBot[]): SortedThreads {
    const result: SortedThreads = { sorted: [], passedOn: [] };
    for (const thread of threads) {
        const first = thread.comments[0];
        if (first === undefined) {
            continue;
        }
        if (parseMarkers(first.body).length > 0) {
            result.passedOn.push(...passedOn(thread, first));
        } else {
            result.sorted.push(sortThread(thread, first, bots));
        }
    }
    return result;
}

function failedCheck({ name, title, summary, url }: CheckRun): CheckFinding {
    return { reporter: "ci", severity: "CRITICAL", name, title, summary, url };
}

function bodiesOf(input: ReportInput): ReviewBody[] {
    return input.reviews.flatMap(({ author, state, url, body, commit }) => {
        const bot = botOf(author, input.bots);
        return bot === null || commit !== input.head || body.trim() === ""
            ? []
            : [{ reporter: bot.id, author, state, url, body }];
    });
}

const FIXED_STATUS = /^Status: fixed in /mu;

function fixedAttempt(marker: Marker, body: string): string | null {
    if (marker.kind === "review" || parseAttemptId(marker.attempt)?.stage !== STAGE) {
        return null;
    }
    const fixed = marker.kind === "resolution" ? marker.state === "fixed" : FIXED_STATUS.test(body);
    return fixed ? marker.attempt : null;
}

// Distinct attempts, never an attempt's number: a discarded attempt raises it without a round.
export function fixedRounds(threads: readonly ReviewThread[]): number {
    const attempts = new Set<string>();
    for (const { body } of threads.flatMap(({ comments }) => comments)) {
        for (const marker of parseMarkers(body)) {
            const attempt = fixedAttempt(marker, body);
            if (attempt !== null) {
                attempts.add(attempt);
            }
        }
    }
    return attempts.size;
}

export function buildReport(input: ReportInput): ExternalReviewReport {
    const { sorted, passedOn: passed } = sortThreads(input.threads, input.bots);
    const found = sorted.flatMap((item) => (item.kind === "finding" ? [item.finding] : []));
    const report = {
        findings: found.filter(({ reporter }) => reporter !== "human"),
        human: found.filter(({ reporter }) => reporter === "human"),
        failedChecks: input.checks.failed.map(failedCheck),
        passedOn: passed,
        bodies: bodiesOf(input),
        accounted: sorted.flatMap((item) => (item.kind === "accounted" ? [item.thread] : [])),
        fixedRounds: fixedRounds(input.threads),
    };
    const quiet =
        report.findings.length +
            report.human.length +
            report.failedChecks.length +
            report.passedOn.length ===
        0;
    return { ...report, quiet };
}
