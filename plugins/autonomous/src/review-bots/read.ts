// The one read of a pull request that selection's wait, the stage's prerequisites and the
// transition guards share (design D1, D5, D6, D13, D14): the GitHub reads here, the rest pure.

import type { PullRequests } from "../pull-request/port.ts";
import type { Result } from "../result.ts";
import {
    type BotStatus,
    botStates,
    type PullRequestChecks,
    pullRequestChecks,
} from "./classify.ts";
import { buildReport, type ExternalReviewReport } from "./report.ts";
import { type Settled, settledOf } from "./settled.ts";
import type { ExternalReviewConfig } from "./types.ts";

export interface ExternalReviewRead {
    number: number;
    draft: boolean;
    head: string; // the head commit's id
    bots: BotStatus[]; // one per configured review bot, in the configuration's order
    checks: PullRequestChecks;
    settled: Settled;
    report: ExternalReviewReport;
}

function failed(what: string, number: number, error: string): { ok: false; error: string } {
    return { ok: false, error: `cannot read the ${what} of pull request #${number}: ${error}` };
}

export async function readExternalReview(
    pullRequests: PullRequests,
    number: number,
    config: ExternalReviewConfig,
    now: Date,
): Promise<Result<ExternalReviewRead>> {
    const state = await pullRequests.state(number);
    if (!state.ok) {
        return failed("state", number, state.error);
    }
    const head = state.value.head.sha;
    const [runs, threads, reviews] = await Promise.all([
        pullRequests.checkRuns(head),
        pullRequests.threads(number),
        pullRequests.reviews(number),
    ]);
    if (!runs.ok) {
        return failed("check runs", number, runs.error);
    }
    if (!threads.ok) {
        return failed("review threads", number, threads.error);
    }
    if (!reviews.ok) {
        return failed("reviews", number, reviews.error);
    }
    const bots = botStates(runs.value, state.value, config, now);
    const checks = pullRequestChecks(runs.value, config.bots);
    const settled = settledOf({
        state: state.value,
        bots,
        checks,
        threads: threads.value,
        answerWaitMinutes: config.answerWaitMinutes,
        now,
    });
    const report = buildReport({
        head,
        threads: threads.value,
        reviews: reviews.value,
        checks,
        bots: config.bots,
    });
    return {
        ok: true,
        value: { number, draft: state.value.draft, head, bots, checks, settled, report },
    };
}
