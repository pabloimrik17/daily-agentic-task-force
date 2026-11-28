// The comments publish mode posts (spec finding-threads, "The comment format", "Hidden markers"
// and "An exact match continues an existing thread"; design D10 to D12).

import type { Tier } from "../review-team/types.ts";
import type { SkippedReviewer } from "../review-team/types.ts";
import { renderMarker } from "./markers.ts";
import { type Published, stageName, type ThreadState } from "./outcome.ts";
import type { RecordEntry } from "./record.ts";

function opening(entry: RecordEntry, published: Published): string {
    const blocking = published.blocking ? " (blocking)" : "";
    return `${published.label}${blocking}: ${entry.title}`;
}

function unique(values: readonly string[]): string[] {
    return [...new Set(values)];
}

function trace(entry: RecordEntry): string {
    const reporters = `Reported by ${unique(entry.reporters.map(({ reviewer }) => reviewer)).join(", ")}`;
    const engines = unique(
        entry.reporters.flatMap(({ engine }) => (engine === undefined ? [] : [engine])),
    );
    const parts =
        entry.kind === "finding"
            ? [
                  reporters,
                  entry.severity,
                  ...(entry.refutation.reproduction === null
                      ? []
                      : [`reproduction: ${entry.refutation.reproduction}`]),
              ]
            : [reporters];
    const all = engines.length === 0 ? parts : [...parts, engines.join(", ")];
    return all.join(" · ");
}

function comment(entry: RecordEntry, published: Published): string {
    return [
        opening(entry, published),
        "",
        entry.statement.trim(),
        "",
        `Status: ${published.status}`,
        "<details><summary>Trace</summary>",
        "",
        trace(entry),
        "</details>",
    ].join("\n");
}

function resolutionMarker(attempt: string, entry: RecordEntry, published: Published): string {
    return renderMarker({
        kind: "resolution",
        attempt,
        finding: entry.id,
        state: published.publication,
    });
}

export function firstComment(attempt: string, entry: RecordEntry, published: Published): string {
    const marker = renderMarker({
        kind: entry.kind,
        attempt,
        finding: entry.id,
        ...(published.for === undefined ? {} : { for: published.for }),
    });
    return `${comment(entry, published)}\n${marker}`;
}

// `mention`: what a reply to a review bot starts with (spec finding-threads, "A reply may mention
// its review bot"); its own paragraph, so the status line still starts a line.
export function stateReply(
    attempt: string,
    entry: RecordEntry,
    published: Published,
    mention: string | null = null,
): string {
    const reply = `Status: ${published.status}\n${resolutionMarker(attempt, entry, published)}`;
    return mention === null ? reply : `${mention}\n\n${reply}`;
}

export function continuingReply(attempt: string, entry: RecordEntry, published: Published): string {
    return `${comment(entry, published)}\n${resolutionMarker(attempt, entry, published)}`;
}

export interface ReviewSummary {
    attempt: string;
    stage: string;
    round: number;
    states: readonly ThreadState[]; // one per thread the review opens
    review: { tier: Tier; skipped: readonly SkippedReviewer[] };
    unanchored?: readonly string[]; // the comments of findings no thread can hold (design D9)
}

function capitalised(text: string): string {
    return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

function skippedLine(skipped: readonly SkippedReviewer[]): string {
    return skipped.length === 0
        ? "none skipped"
        : `skipped ${skipped.map(({ reviewer, reason }) => `${reviewer} (${reason})`).join(", ")}`;
}

export function reviewBody(summary: ReviewSummary): string {
    const count = (state: ThreadState): number =>
        summary.states.filter((item) => item === state).length;
    const lines = [
        `${capitalised(stageName(summary.stage))}, round ${summary.round}`,
        `Threads: ${count("open")} open, ${count("resolved")} resolved`,
        `Review team: tier ${summary.review.tier}, ${skippedLine(summary.review.skipped)}`,
    ];
    const comments = (summary.unanchored ?? []).map((body) => `\n${body}`);
    const marker = renderMarker({ kind: "review", attempt: summary.attempt, round: summary.round });
    return [...lines, ...comments, marker].join("\n");
}

const OPENING = /^(?:issue|suggestion|question)(?: \(blocking\))?: (.+)$/u;

export function titleOf(firstCommentBody: string): string | null {
    const [first = ""] = firstCommentBody.split("\n");
    return OPENING.exec(first.trimEnd())?.[1] ?? null;
}

export function normalisedTitle(title: string): string {
    return title.replace(/\s+/gu, "").toLowerCase();
}

export function sameTitle(left: string, right: string): boolean {
    return normalisedTitle(left) === normalisedTitle(right);
}
