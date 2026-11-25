// What publish mode does with each published entry of the record (spec finding-threads, "Existing
// threads are answered, never duplicated", "Publishing is idempotent within an attempt", "An exact
// match continues an existing thread" and "Only the stage's own threads are touched"; design D10).
// The plan is read from the pull request's threads alone, so a run cut short is completed by the
// next one.

import { parseAttemptId } from "../attempts/record.ts";
import type { ReviewThread, ThreadAnchor } from "../pull-request/port.ts";
import type { Result } from "../result.ts";
import { anchorFor, type DiffFile } from "./anchor.ts";
import { sameTitle, titleOf } from "./format.ts";
import { type Marker, parseMarkers, threadMarker } from "./markers.ts";
import { publicationOf, type Published } from "./outcome.ts";
import type { RecordEntry } from "./record.ts";

export const STAGE = "code-review";

// `match`: an exact match this run continues with the full comment.
type Target =
    | { kind: "thread"; thread: ReviewThread; match: boolean }
    | { kind: "new"; anchor: ThreadAnchor | null }; // null: no thread can hold it (design D9)

export interface Planned {
    entry: RecordEntry;
    published: Published;
    target: Target;
}

export interface PlanInput {
    attempt: string;
    entries: readonly RecordEntry[];
    threads: readonly ReviewThread[];
    files: readonly DiffFile[];
    change: string;
}

// A thread a code review published, whichever attempt.
function publishedByCodeReview(thread: ReviewThread): boolean {
    const marker = threadMarker(thread.comments[0]?.body ?? "");
    return marker !== null && parseAttemptId(marker.attempt)?.stage === STAGE;
}

function namesEntry(marker: Marker, attempt: string, finding: string): boolean {
    return marker.kind !== "review" && marker.attempt === attempt && marker.finding === finding;
}

// The thread this attempt already posted the finding in: opened for it, or answered for it.
function postedIn(
    threads: readonly ReviewThread[],
    attempt: string,
    finding: string,
): ReviewThread | undefined {
    return threads.find(({ comments }) =>
        comments.some(({ body }) =>
            parseMarkers(body).some((marker) => namesEntry(marker, attempt, finding)),
        ),
    );
}

function sameAnchor(thread: ReviewThread, anchor: ThreadAnchor): boolean {
    if (anchor.kind === "file") {
        return thread.subjectType === "FILE" && thread.path === anchor.path;
    }
    return (
        thread.subjectType === "LINE" &&
        thread.path === anchor.path &&
        thread.side === anchor.side &&
        thread.line === anchor.line &&
        thread.startLine === (anchor.startLine ?? null)
    );
}

// An earlier attempt's code review thread with the same anchor and title; a thread this attempt
// opened belongs to another of its findings, and one thread continues one finding.
function exactMatch(
    input: PlanInput,
    entry: RecordEntry,
    anchor: ThreadAnchor,
    taken: ReadonlySet<string>,
): ReviewThread | undefined {
    return input.threads.find((thread) => {
        const first = thread.comments[0]?.body ?? "";
        const title = titleOf(first);
        return (
            !taken.has(thread.id) &&
            publishedByCodeReview(thread) &&
            threadMarker(first)?.attempt !== input.attempt &&
            sameAnchor(thread, anchor) &&
            title !== null &&
            sameTitle(title, entry.title)
        );
    });
}

function linkedThread(input: PlanInput, entry: RecordEntry, id: string): Result<Target> {
    const thread = input.threads.find((item) => item.id === id);
    return thread === undefined
        ? {
              ok: false,
              error: `entry ${entry.id} continues the thread ${id}, which the pull request does not hold`,
          }
        : { ok: true, value: { kind: "thread", thread, match: false } };
}

function targetOf(
    input: PlanInput,
    entry: RecordEntry,
    taken: ReadonlySet<string>,
): Result<Target> {
    if (entry.thread !== null) {
        return linkedThread(input, entry, entry.thread);
    }
    const posted = postedIn(input.threads, input.attempt, entry.id);
    if (posted !== undefined) {
        return { ok: true, value: { kind: "thread", thread: posted, match: false } };
    }
    const anchor = anchorFor(entry.location, input.files, input.change);
    const matched = anchor === null ? undefined : exactMatch(input, entry, anchor, taken);
    return {
        ok: true,
        value:
            matched === undefined
                ? { kind: "new", anchor }
                : { kind: "thread", thread: matched, match: true },
    };
}

// Every published entry with what to do; an entry linked to a thread the pull request does not
// hold fails the plan, so nothing is posted.
export function planEntries(input: PlanInput): Result<Planned[]> {
    const planned: Planned[] = [];
    const taken = new Set<string>();
    for (const entry of input.entries) {
        const published = publicationOf(entry);
        if (published === null) {
            continue;
        }
        const target = targetOf(input, entry, taken);
        if (!target.ok) {
            return target;
        }
        if (target.value.kind === "thread") {
            taken.add(target.value.thread.id);
        }
        planned.push({ entry, published, target: target.value });
    }
    return { ok: true, value: planned };
}

const STATUS = /^Status: (.*)$/mu;

// The state this attempt last posted for the finding in the thread: the status line of its last
// comment naming the finding, and the resolution marker's state. A proposed deferral and a created
// one share the state `deferred`, so the status tells them apart.
function lastPosted(
    thread: ReviewThread,
    attempt: string,
    finding: string,
): { status: string; state: string | null } | null {
    let last: { status: string; state: string | null } | null = null;
    for (const { body } of thread.comments) {
        const marker = parseMarkers(body).find((item) => namesEntry(item, attempt, finding));
        if (marker !== undefined) {
            const status = STATUS.exec(body)?.[1]?.trimEnd() ?? "";
            last = { status, state: marker.kind === "resolution" ? marker.state : null };
        }
    }
    return last;
}

export function showsState(thread: ReviewThread, attempt: string, planned: Planned): boolean {
    const last = lastPosted(thread, attempt, planned.entry.id);
    const { status, publication } = planned.published;
    return last !== null && last.status === status && (last.state ?? publication) === publication;
}

export function wantsResolved(planned: Planned): boolean {
    return planned.published.state === "resolved";
}
