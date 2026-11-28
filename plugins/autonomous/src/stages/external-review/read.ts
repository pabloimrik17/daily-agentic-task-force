// Spec external-review-stage, "External review prerequisites" and "What the prerequisites read
// reaches the prompt"; design D5, D7 and D9. The read is selection's wait (review-bots/read.ts), so a
// launch by hand with `--task` waits for what a selected task waits for.

import type { BotStatus } from "../../review-bots/classify.ts";
import { readExternalReview } from "../../review-bots/read.ts";
import type { ExternalReviewReport } from "../../review-bots/report.ts";
import type { Result } from "../../result.ts";
import { type Check, contextValue, requiredPullRequest } from "../openspec-stage.ts";
import type { StageContext } from "../stage.ts";

export const EXTERNAL_REVIEW_KEY = "externalReview";

const STAGE = "external-review";

// What the prompt carries of the read: the round is decided by code (design D9).
export interface ExternalReviewContext {
    head: string; // the head commit's id
    bots: BotStatus[];
    report: ExternalReviewReport;
    rounds: number; // the round limit, `review.external.rounds`
}

const failed = (error: string): Result<StageContext> => ({ ok: false, error });

// Each reason is a wait naming what is waited for; nothing here marks a pull request ready.
export const externalReviewCheck: Check = async ({ readers, externalReview }, read) => {
    if (externalReview === undefined) {
        return failed("the external-review prerequisites were given no review.external settings");
    }
    const { number } = requiredPullRequest(read, STAGE);
    const { config, now } = externalReview;
    const found = await readExternalReview(readers.pullRequests, number, config, now);
    if (!found.ok) {
        return found;
    }
    const { draft, settled, head, bots, report } = found.value;
    if (draft) {
        return failed(
            `pull request #${number} is a draft: waiting for it to be marked ready for review`,
        );
    }
    if (!settled.settled) {
        return failed(
            `waiting for the review bots of pull request #${number}: ${settled.reasons.join("; ")}`,
        );
    }
    const value: ExternalReviewContext = { head, bots, report, rounds: config.rounds };
    return { ok: true, value: { [EXTERNAL_REVIEW_KEY]: JSON.stringify(value) } };
};

export function externalReviewOf(context: StageContext): ExternalReviewContext {
    return JSON.parse(contextValue(context, STAGE, EXTERNAL_REVIEW_KEY)) as ExternalReviewContext;
}
