import { describe, expect, it } from "vitest";

import { botStates, pullRequestChecks } from "./classify.ts";
import { settledOf } from "./settled.ts";
import {
    ALL_PASSED,
    COMMITTED_AT,
    CONFIG,
    comment,
    externalReply,
    minutesAfter,
    prState,
    run,
    thread,
} from "./test-fixtures.ts";
import type { CheckRun, PullRequestState, ReviewThread } from "../pull-request/port.ts";

function settled(
    runs: CheckRun[],
    now: Date,
    threads: ReviewThread[] = [],
    state: PullRequestState = prState(),
) {
    return settledOf({
        state,
        bots: botStates(runs, state, CONFIG, now),
        checks: pullRequestChecks(runs, CONFIG.bots),
        threads,
        answerWaitMinutes: CONFIG.answerWaitMinutes,
        now,
    });
}

const LATER = minutesAfter(COMMITTED_AT, 40);

describe("A settled pull request", () => {
    it("Bot reviewing: with Pullfrog reviewing the pull request is not settled", () => {
        const runs = ALL_PASSED.map((item) =>
            item.name === "pullfrog"
                ? run("pullfrog", { status: "in_progress", conclusion: null })
                : item,
        );
        expect(settled(runs, LATER)).toEqual({
            settled: false,
            reasons: ["pullfrog is reviewing"],
        });
    });

    it("Round that only answered: a last reply 4 minutes ago, with an answer wait of 10, is not settled", () => {
        const repliedAt = minutesAfter(COMMITTED_AT, 36).toISOString();
        const answered = thread([
            comment("coderabbitai", "Major: a bug"),
            comment("someone", externalReply(1, "f1", "none"), repliedAt),
        ]);
        expect(settled(ALL_PASSED, LATER, [answered])).toEqual({
            settled: false,
            reasons: [
                "the review bots have 6 minutes left to answer the last external review reply",
            ],
        });
    });

    it("Everything in: two bots reported, Greptile not reviewing, checks ended and no reply within its wait, it is settled", () => {
        const runs = ALL_PASSED.map((item) =>
            item.name === "Greptile Review"
                ? run("Greptile Review", { conclusion: "neutral", title: "Review was cancelled" })
                : item,
        );
        const old = thread([
            comment("coderabbitai", "Major: a bug"),
            comment(
                "someone",
                externalReply(1, "f1", "none"),
                minutesAfter(COMMITTED_AT, -5).toISOString(),
            ),
        ]);
        expect(settled(runs, LATER, [old])).toEqual({ settled: true, reasons: [] });
    });

    it("names a draft, the running checks and a waiting bot among the reasons", () => {
        const runs = [
            ...ALL_PASSED.filter(({ name }) => name !== "Greptile Review"),
            run("audit", { status: "queued", conclusion: null }),
        ];
        const now = minutesAfter(COMMITTED_AT, 10);
        expect(settled(runs, now, [], prState({ draft: true })).reasons).toEqual([
            "the pull request is a draft",
            "checks still running: audit",
            "greptile is waiting, 20 minutes left",
        ]);
    });
});
