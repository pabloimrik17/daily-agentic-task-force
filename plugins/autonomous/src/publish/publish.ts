// Publish mode (spec autonomous-run, "Publish mode"; spec finding-threads; design D6 and D9 to
// D13): posts a code-review attempt's findings as finding threads, one post at a time, reads them
// back, brings the walkthrough up to date and writes `published.json`. It posts only COMMENT
// reviews, replies and resolutions: the pull request stays a draft. A failed post stops the run,
// and the next run continues from the markers.

import { acquireLockAt } from "../attempts/lock.ts";
import type { AttemptId } from "../attempts/record.ts";
import { publishLockPath } from "../attempts/state.ts";
import type { Exec } from "../exec.ts";
import type { ReviewThread } from "../pull-request/port.ts";
import { READ_BACK_TRIES, readUntil, type Wait } from "../read-back.ts";
import type { Result } from "../result.ts";
import { guideAvailability } from "../review-team/availability.ts";
import { continuingReply, firstComment, reviewBody, stateReply } from "./format.ts";
import { threadMarker } from "./markers.ts";
import { type Planned, planEntries, showsState, STAGE, wantsResolved } from "./plan.ts";
import { type PrepareDeps, prepare, type Prepared, findAttempt } from "./prepare.ts";
import { PUBLISH_RECEIPT_SCHEMA, readPublishReceipt, writePublishReceipt } from "./receipt.ts";
import { blankPublish, type PublishReport, type ThreadPost } from "./report.ts";
import type {
    PlannotatorAccess,
    WalkthroughInput,
    WalkthroughNote,
    WalkthroughOutcome,
} from "./walkthrough.ts";

export interface PublishDeps extends PrepareDeps {
    plannotatorIn: (directory: string) => Exec; // `plannotator guide import` reads git there
    walkthrough: (
        input: WalkthroughInput,
        plannotator: PlannotatorAccess,
    ) => Promise<WalkthroughOutcome>;
    wait?: Wait;
}

interface Publishing extends Prepared {
    deps: PublishDeps;
    report: PublishReport;
}

type Threaded = Planned & { target: { kind: "thread" } };

const isThreaded = (planned: Planned): planned is Threaded => planned.target.kind === "thread";

const urlOf = (thread: ReviewThread) => thread.comments[0]?.url ?? "";

export async function runPublish(
    attempt: AttemptId,
    deps: PublishDeps,
    startedAt: Date,
): Promise<PublishReport> {
    const report = blankPublish(attempt, startedAt);
    const failure = await publishLocked(attempt, deps, report);
    if (failure !== null) {
        report.reasons.push(failure);
        return report;
    }
    report.outcome = "advance";
    return report;
}

// One publication per attempt at a time: the lock is held from before the findings and the
// threads are read until the receipt is written, so two runs never post one round's review
// twice, and none publishes a record another has already replaced.
async function publishLocked(
    attempt: AttemptId,
    deps: PublishDeps,
    report: PublishReport,
): Promise<string | null> {
    const found = await findAttempt(attempt, deps, report);
    if (!found.ok) {
        return found.error;
    }
    const file = publishLockPath(found.value.dir);
    const lock = await acquireLockAt(file, undefined, undefined, "publication");
    if (!lock.ok) {
        return lock.error;
    }
    try {
        const prepared = await prepare(found.value, deps, report);
        return prepared.ok ? await publish({ ...prepared.value, deps, report }) : prepared.error;
    } finally {
        await lock.release();
    }
}

async function publish(publishing: Publishing): Promise<string | null> {
    const first = plan(publishing, publishing.threads);
    if (!first.ok) {
        return first.error;
    }
    const reviewed = await postReviews(publishing, first.value);
    if (!reviewed.ok) {
        return reviewed.error;
    }
    const planned = reviewed.value ? await replan(publishing, first.value) : first;
    if (!planned.ok) {
        return planned.error;
    }
    const threaded = planned.value.filter(isThreaded);
    const answered = await answer(publishing, threaded);
    if (answered !== null) {
        return answered;
    }
    const back = await readBack(publishing, threaded);
    return back.ok ? finish(publishing, threaded, back.value) : back.error;
}

function plan(publishing: Publishing, threads: readonly ReviewThread[]): Result<Planned[]> {
    const { findings, files, change } = publishing;
    return planEntries({
        attempt: findings.attempt,
        entries: findings.entries,
        threads,
        files,
        change,
    });
}

// Design D11: one review per round with new threads; the comments no thread can hold go in its
// body. True when a review was posted.
async function postReviews(
    publishing: Publishing,
    planned: readonly Planned[],
): Promise<Result<boolean>> {
    const rounds = [...new Set(planned.map(({ entry }) => entry.round))].sort((a, b) => a - b);
    let posted = false;
    for (const round of rounds) {
        const inRound = planned.filter(({ entry }) => entry.round === round);
        const review = await postReview(publishing, round, inRound);
        if (!review.ok) {
            return review;
        }
        posted ||= review.value;
    }
    return { ok: true, value: posted };
}

async function postReview(
    publishing: Publishing,
    round: number,
    planned: readonly Planned[],
): Promise<Result<boolean>> {
    const { findings, port, pullRequest, report } = publishing;
    const comment = ({ entry, published }: Planned) =>
        firstComment(findings.attempt, entry, published);
    const fresh = planned.filter(({ target }) => target.kind === "new");
    const anchored = fresh.flatMap((item) =>
        item.target.kind === "new" && item.target.anchor !== null
            ? [{ item, anchor: item.target.anchor }]
            : [],
    );
    const unanchored = fresh.filter((item) => !anchored.some((a) => a.item === item));
    if (anchored.length === 0) {
        noteUnanchored(publishing, round, planned, unanchored);
        return { ok: true, value: false };
    }
    const body = reviewBody({
        attempt: findings.attempt,
        stage: STAGE,
        round,
        states: anchored.flatMap(({ item }) =>
            item.published.state === "kept" ? [] : [item.published.state],
        ),
        review: findings.review,
        unanchored: unanchored.map(comment),
    });
    const threads = anchored.map(({ item, anchor }) => ({ anchor, body: comment(item) }));
    const posted = await port.review(pullRequest.number, body, threads);
    if (!posted.ok) {
        return posted;
    }
    report.reviews.push({ round, url: posted.value.url });
    return { ok: true, value: true };
}

// A round that opens no thread posts no review, so a comment no thread can hold has no body to go
// in. A round that holds a thread this attempt opened posted its review earlier, which carried it;
// a linked thread or an exact match belongs to no review of this attempt.
function noteUnanchored(
    { findings, report }: Publishing,
    round: number,
    planned: readonly Planned[],
    unanchored: readonly Planned[],
): void {
    if (planned.some((item) => openedBy(findings.attempt, item))) {
        return;
    }
    for (const { entry } of unanchored) {
        report.notes.push(
            `${entry.id} is not published: no thread can hold it, and round ${round} opens no thread whose review could carry it`,
        );
    }
}

function openedBy(attempt: string, { entry, target }: Planned): boolean {
    if (target.kind !== "thread") {
        return false;
    }
    const marker = threadMarker(target.thread.comments[0]?.body ?? "");
    return marker?.attempt === attempt && marker.finding === entry.id;
}

const opensThread = ({ target }: Planned) => target.kind === "new" && target.anchor !== null;

function threadOf(planned: readonly Planned[], id: string): ReviewThread | undefined {
    const target = planned.find((item) => item.entry.id === id)?.target;
    return target?.kind === "thread" ? target.thread : undefined;
}

// True once the list shows a thread for every entry the review opened one for. A list the plan
// refuses settles too: `replan` reports it.
function showsOpened(
    publishing: Publishing,
    opened: readonly Planned[],
    threads: readonly ReviewThread[],
): boolean {
    const now = plan(publishing, threads);
    return !now.ok || opened.every(({ entry }) => threadOf(now.value, entry.id) !== undefined);
}

// The read that follows the review can lag it, as the one `readBack` repeats.
async function replan(
    publishing: Publishing,
    before: readonly Planned[],
): Promise<Result<Planned[]>> {
    const { deps, port, pullRequest, report } = publishing;
    const opened = before.filter(opensThread);
    const threads = await readUntil(
        () => port.threads(pullRequest.number),
        (read) => showsOpened(publishing, opened, read),
        deps.wait,
    );
    if (!threads.ok) {
        return threads;
    }
    const planned = plan(publishing, threads.value);
    if (!planned.ok) {
        return planned;
    }
    for (const { entry } of opened) {
        const thread = threadOf(planned.value, entry.id);
        if (thread === undefined) {
            return {
                ok: false,
                error: `the review was posted but pull request #${pullRequest.number} holds no thread for ${entry.id} (${READ_BACK_TRIES})`,
            };
        }
        report.threads.opened.push({ finding: entry.id, url: urlOf(thread) });
    }
    return planned;
}

// Replies first, then the resolution each thread's state needs; one post at a time.
async function answer(
    publishing: Publishing,
    threaded: readonly Threaded[],
): Promise<string | null> {
    const settling: Settling = { threaded, settled: new Set() };
    for (const planned of threaded) {
        const replied = await reply(publishing, planned);
        if (replied !== null) {
            return replied;
        }
        const resolved = await settle(publishing, planned, settling);
        if (resolved !== null) {
            return resolved;
        }
    }
    return null;
}

// The threads this run already resolved or unresolved: entries that share one settle it once.
interface Settling {
    threaded: readonly Threaded[];
    settled: Set<string>;
}

async function reply(publishing: Publishing, planned: Threaded): Promise<string | null> {
    const { findings, port, report } = publishing;
    const { entry, published, target } = planned;
    const { thread, match } = target;
    if (!match && showsState(thread, findings.attempt, planned)) {
        return null;
    }
    const body = (match ? continuingReply : stateReply)(findings.attempt, entry, published);
    const posted = await port.reply(thread.id, body);
    if (!posted.ok) {
        return posted.error;
    }
    const post: ThreadPost = { finding: entry.id, url: urlOf(thread) };
    report.threads.answered.push(post);
    if (match) {
        report.matches.push(post);
    }
    return null;
}

async function settle(
    { port, report }: Publishing,
    planned: Threaded,
    { threaded, settled }: Settling,
): Promise<string | null> {
    const { thread } = planned.target;
    const resolved = wantsResolved(planned, threaded);
    if (resolved === null || thread.resolved === resolved || settled.has(thread.id)) {
        return null;
    }
    settled.add(thread.id);
    const changed = await (resolved ? port.resolve(thread.id) : port.unresolve(thread.id));
    if (!changed.ok) {
        return changed.error;
    }
    const post = { finding: planned.entry.id, url: urlOf(thread) };
    (resolved ? report.threads.resolved : report.threads.unresolved).push(post);
    return null;
}

// What the read-back finds wrong: a thread missing, its state not posted, or not resolved as it
// should be.
function misplaced(
    attempt: string,
    threaded: readonly Threaded[],
    threads: readonly ReviewThread[],
): string[] {
    return threaded.flatMap((planned) => {
        const thread = threads.find(({ id }) => id === planned.target.thread.id);
        const { id } = planned.entry;
        if (thread === undefined) {
            return [`the thread of ${id} is gone`];
        }
        if (!showsState(thread, attempt, planned)) {
            return [`the thread of ${id} does not show "${planned.published.status}"`];
        }
        const wanted = wantsResolved(planned, threaded);
        return wanted === null || thread.resolved === wanted
            ? []
            : [`the thread of ${id} is ${thread.resolved ? "resolved" : "open"}`];
    });
}

async function readBack(
    { deps, findings, port, pullRequest }: Publishing,
    threaded: readonly Threaded[],
): Promise<Result<ReviewThread[]>> {
    const back = await readUntil(
        () => port.threads(pullRequest.number),
        (threads) => misplaced(findings.attempt, threaded, threads).length === 0,
        deps.wait,
    );
    if (!back.ok) {
        return back;
    }
    const wrong = misplaced(findings.attempt, threaded, back.value);
    return wrong.length === 0
        ? back
        : {
              ok: false,
              error: `pull request #${pullRequest.number} read back wrong: ${wrong.join("; ")} (${READ_BACK_TRIES})`,
          };
}

async function finish(
    publishing: Publishing,
    threaded: readonly Threaded[],
    threads: readonly ReviewThread[],
): Promise<string | null> {
    const { dir, findings, pullRequest, report, digest } = publishing;
    const outcome = await updateWalkthrough(publishing, notesOf(threaded, threads));
    report.walkthrough = {
        outcome: outcome.outcome,
        reason: outcome.outcome === "none" ? outcome.reason : null,
    };
    const written = await writePublishReceipt(dir, {
        schema: PUBLISH_RECEIPT_SCHEMA,
        attempt: findings.attempt,
        pullRequest: { number: pullRequest.number, url: pullRequest.url },
        findingsDigest: digest,
        walkthroughDigest: outcome.outcome === "none" ? null : outcome.digest,
        publishedAt: report.startedAt,
    });
    if (!written.ok) {
        return written.error;
    }
    report.receipt = written.value;
    return null;
}

function notesOf(
    threaded: readonly Threaded[],
    threads: readonly ReviewThread[],
): WalkthroughNote[] {
    return threaded
        .filter(({ published }) => published.state !== "kept")
        .map(({ entry, published, target }) => {
            const thread = threads.find(({ id }) => id === target.thread.id) ?? target.thread;
            return {
                finding: entry.id,
                label: `${published.label}${published.blocking ? " (blocking)" : ""}`,
                statement: entry.statement,
                status: published.status,
                url: urlOf(thread),
                location: entry.location,
            };
        });
}

async function updateWalkthrough(
    publishing: Publishing,
    notes: WalkthroughNote[],
): Promise<WalkthroughOutcome> {
    const { deps, dir, patch, files, pullRequest, record, report } = publishing;
    const last = await readPublishReceipt(dir);
    if (!last.ok) {
        report.notes.push(`${last.error}; the walkthrough is saved as if never saved before`);
    }
    const plannotator = await plannotatorAccess(deps.plannotatorIn(record.workspace.path));
    return deps.walkthrough(
        {
            attemptDir: dir,
            patch,
            files,
            notes,
            pullRequestUrl: pullRequest.url,
            lastDigest: last.ok ? (last.value?.walkthroughDigest ?? null) : null,
        },
        plannotator,
    );
}

async function plannotatorAccess(exec: Exec): Promise<PlannotatorAccess> {
    const found = await guideAvailability({ exec: () => exec });
    return found.available
        ? { available: true, exec }
        : { available: false, reason: found.reason ?? "not available" };
}
