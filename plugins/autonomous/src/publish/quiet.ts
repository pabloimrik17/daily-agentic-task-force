// The quiet round of an external review (spec finding-threads, "The quiet round resolves the
// answered threads", "The quiet round dismisses a review bot's request for changes" and "The
// receipt records a quiet round"; design D12 of add-external-review-stage). After the record's
// entries are read back, it resolves the threads an external review answered for good, dismisses
// the request for changes of each review bot left with no open thread, and reads both back; the
// receipt is written only after that. It never approves.

import type { PullRequests, Review, ReviewThread } from "../pull-request/port.ts";
import { READ_BACK_TRIES, readUntil, type Wait } from "../read-back.ts";
import type { Result } from "../result.ts";
import { botOf, externalReviewReply } from "../review-bots/identify.ts";
import type { ReviewBot } from "../review-bots/types.ts";
import { parseMarkers } from "./markers.ts";
import { statusOf } from "./plan.ts";
import type { PublishReport } from "./report.ts";

export interface QuietRound {
    port: PullRequests;
    number: number; // the pull request's
    bots: readonly ReviewBot[];
    report: PublishReport;
    wait?: Wait | undefined;
}

// What the round changed, for the read-back: thread ids and review ids.
interface Changed {
    resolved: readonly string[];
    dismissed: readonly string[];
}

interface Read {
    threads: ReviewThread[];
    reviews: Review[];
}

// The answers that account for a finding: fixed, refuted, dismissed, settled, or deferred to a
// created task. Blocked, asked and a proposed deferral keep the thread open.
const ACCOUNTED = /^(?:fixed in |not published \((?:refuted|dismissed|settled)\)|deferred to )/u;

const FIXED = /^fixed in /u;

const urlOf = (thread: ReviewThread) => thread.comments[0]?.url ?? "";

// The status of the thread's last external review reply, or null when it holds none.
function answered(thread: ReviewThread): string | null {
    const reply = thread.comments.findLast(({ body }) => externalReviewReply(body) !== null);
    return reply === undefined ? null : statusOf(reply.body);
}

// The status of the thread's last comment when an external review wrote it; a later comment
// contests the answer.
function lastAnswer(thread: ReviewThread): string | null {
    const body = thread.comments.at(-1)?.body ?? "";
    return externalReviewReply(body) === null ? null : statusOf(body);
}

// A human reviewer's thread: its first comment is neither a review bot's nor marked by the runner.
// The person who opened it closes it, unless its finding was fixed.
function humanThread(thread: ReviewThread, bots: readonly ReviewBot[]): boolean {
    const first = thread.comments[0];
    return (
        first !== undefined &&
        botOf(first.author, bots) === null &&
        parseMarkers(first.body).length === 0
    );
}

function resolvable(thread: ReviewThread, bots: readonly ReviewBot[]): boolean {
    const status = lastAnswer(thread);
    if (thread.resolved || status === null || !ACCOUNTED.test(status)) {
        return false;
    }
    return FIXED.test(status) || !humanThread(thread, bots);
}

function findingOf(thread: ReviewThread): string {
    const body = thread.comments.at(-1)?.body ?? "";
    const marker = parseMarkers(body).find((item) => item.kind === "resolution");
    return marker?.kind === "resolution" ? marker.finding : "";
}

async function resolveAnswered(
    round: QuietRound,
    threads: readonly ReviewThread[],
): Promise<Result<string[]>> {
    const resolved: string[] = [];
    for (const thread of threads.filter((item) => resolvable(item, round.bots))) {
        const done = await round.port.resolve(thread.id);
        if (!done.ok) {
            return done;
        }
        resolved.push(thread.id);
        round.report.threads.resolved.push({ finding: findingOf(thread), url: urlOf(thread) });
    }
    return { ok: true, value: resolved };
}

function threadsOf(bot: ReviewBot, threads: readonly ReviewThread[]): ReviewThread[] {
    return threads.filter((thread) => botOf(thread.comments[0]?.author ?? "", [bot]) !== null);
}

function addressed(threads: readonly ReviewThread[]): string {
    const statuses = threads.flatMap((thread) => answered(thread) ?? []);
    const fixed = statuses.filter((status) => FIXED.test(status)).length;
    return `Addressed: ${fixed} fixed, ${statuses.length - fixed} answered`;
}

// A bot's requests for changes, once none of its threads is open.
async function dismissBot(
    round: QuietRound,
    bot: ReviewBot,
    threads: readonly ReviewThread[],
    reviews: readonly Review[],
): Promise<Result<string[]>> {
    const own = threadsOf(bot, threads);
    if (own.some(({ resolved }) => !resolved)) {
        return { ok: true, value: [] };
    }
    const requests = reviews.filter(
        ({ author, state }) => state === "CHANGES_REQUESTED" && botOf(author, [bot]) !== null,
    );
    for (const review of requests) {
        const done = await round.port.dismiss(round.number, review.id, addressed(own));
        if (!done.ok) {
            return done;
        }
        round.report.dismissed.push({ bot: bot.id, url: review.url });
    }
    return { ok: true, value: requests.map(({ id }) => id) };
}

async function dismissRequests(
    round: QuietRound,
    threads: readonly ReviewThread[],
): Promise<Result<string[]>> {
    const reviews = await round.port.reviews(round.number);
    if (!reviews.ok) {
        return reviews;
    }
    const dismissed: string[] = [];
    for (const bot of round.bots) {
        const done = await dismissBot(round, bot, threads, reviews.value);
        if (!done.ok) {
            return done;
        }
        dismissed.push(...done.value);
    }
    return { ok: true, value: dismissed };
}

function wrong(changed: Changed, { threads, reviews }: Read): string[] {
    const open = changed.resolved.flatMap((id) => {
        const thread = threads.find((item) => item.id === id);
        if (thread === undefined) {
            return [`the thread ${id} is gone`];
        }
        return thread.resolved ? [] : [`the thread ${urlOf(thread)} is open`];
    });
    const kept = changed.dismissed.flatMap((id) => {
        const state = reviews.find((item) => item.id === id)?.state ?? "gone";
        return state === "DISMISSED" ? [] : [`the review ${id} is ${state}`];
    });
    return [...open, ...kept];
}

async function readBoth(round: QuietRound): Promise<Result<Read>> {
    const threads = await round.port.threads(round.number);
    if (!threads.ok) {
        return threads;
    }
    const reviews = await round.port.reviews(round.number);
    return reviews.ok
        ? { ok: true, value: { threads: threads.value, reviews: reviews.value } }
        : reviews;
}

async function readBack(round: QuietRound, changed: Changed): Promise<string | null> {
    if (changed.resolved.length === 0 && changed.dismissed.length === 0) {
        return null;
    }
    const back = await readUntil(
        () => readBoth(round),
        (read) => wrong(changed, read).length === 0,
        round.wait,
    );
    if (!back.ok) {
        return back.error;
    }
    const faults = wrong(changed, back.value);
    return faults.length === 0
        ? null
        : `pull request #${round.number} read back wrong: ${faults.join("; ")} (${READ_BACK_TRIES})`;
}

// `threads`: the pull request's threads as read back after the record's entries. Null when the
// round's resolutions and dismissals are posted and read back.
export async function settleQuietRound(
    round: QuietRound,
    threads: readonly ReviewThread[],
): Promise<string | null> {
    const resolved = await resolveAnswered(round, threads);
    if (!resolved.ok) {
        return resolved.error;
    }
    const after = threads.map((thread) =>
        resolved.value.includes(thread.id) ? { ...thread, resolved: true } : thread,
    );
    const dismissed = await dismissRequests(round, after);
    if (!dismissed.ok) {
        return dismissed.error;
    }
    return readBack(round, { resolved: resolved.value, dismissed: dismissed.value });
}
