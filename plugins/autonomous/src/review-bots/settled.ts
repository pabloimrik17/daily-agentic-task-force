// A settled pull request (spec review-bots, "A settled pull request"; design D6). Every reason it
// is not settled is a line of the run's report, so each one names what is missing.

import type { PullRequestState, ReviewThread } from "../pull-request/port.ts";
import { type BotStatus, MINUTE_MS, type PullRequestChecks } from "./classify.ts";
import { externalReviewReply } from "./identify.ts";

export interface Settled {
    settled: boolean;
    reasons: string[]; // empty when settled
}

interface SettledInput {
    state: PullRequestState;
    bots: readonly BotStatus[];
    checks: PullRequestChecks;
    threads: readonly ReviewThread[];
    answerWaitMinutes: number;
    now: Date;
}

function botReason({ bot, state }: BotStatus): string[] {
    if (state.kind === "reviewing") {
        return [`${bot} is reviewing`];
    }
    return state.kind === "waiting" ? [`${bot} is waiting, ${state.minutesLeft} minutes left`] : [];
}

// The newest external review reply posted after the head commit: the wait of a round that pushed
// nothing, which a push resets because the bots then answer through their check runs.
function newestReply(threads: readonly ReviewThread[], after: number): number | null {
    let newest: number | null = null;
    for (const comment of threads.flatMap(({ comments }) => comments)) {
        const at = Date.parse(comment.createdAt);
        if (at > after && (newest === null || at > newest) && externalReviewReply(comment.body)) {
            newest = at;
        }
    }
    return newest;
}

function answerReason(input: SettledInput): string[] {
    const reply = newestReply(input.threads, Date.parse(input.state.head.committedAt));
    if (reply === null) {
        return [];
    }
    const left = reply + input.answerWaitMinutes * MINUTE_MS - input.now.getTime();
    return left > 0
        ? [
              `the review bots have ${Math.ceil(left / MINUTE_MS)} minutes left to answer the last external review reply`,
          ]
        : [];
}

export function settledOf(input: SettledInput): Settled {
    const running = input.checks.running.map(({ name }) => name);
    const reasons = [
        ...(input.state.draft ? ["the pull request is a draft"] : []),
        ...(running.length === 0 ? [] : [`checks still running: ${running.join(", ")}`]),
        ...input.bots.flatMap(botReason),
        ...answerReason(input),
    ];
    return { settled: reasons.length === 0, reasons };
}
