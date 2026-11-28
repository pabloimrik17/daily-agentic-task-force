import { describe, expect, it } from "vitest";

import { botStates, pullRequestChecks } from "./classify.ts";
import { ALL_PASSED, COMMITTED_AT, CONFIG, minutesAfter, prState, run } from "./test-fixtures.ts";

const NOW = minutesAfter(COMMITTED_AT, 5);

function stateOf(bot: string, runs = ALL_PASSED, state = prState(), now = NOW) {
    return botStates(runs, state, CONFIG, now).find((status) => status.bot === bot)?.state;
}

describe("A review bot's state for a head commit", () => {
    it("Reported: a completed CodeRabbit run with success is reported", () => {
        expect(stateOf("coderabbit")).toEqual({ kind: "reported" });
    });

    it("Rate limited: a neutral CodeRabbit run is not reviewing, with its title as the reason", () => {
        const runs = [run("CodeRabbit", { conclusion: "neutral", title: "Review rate limited" })];
        expect(stateOf("coderabbit", runs)).toEqual({
            kind: "not-reviewing",
            reason: "Review rate limited",
        });
    });

    it("Reported on an earlier commit only: Pullfrog, with no run among the head commit's, has not reported", () => {
        const runs = ALL_PASSED.filter(({ name }) => name !== "pullfrog");
        expect(stateOf("pullfrog", runs)).toEqual({ kind: "waiting", minutesLeft: 25 });
    });

    it("a queued or in-progress run is reviewing, and the latest run of a bot decides", () => {
        const runs = [
            run("pullfrog", { conclusion: "cancelled", startedAt: "2026-11-28T10:01:00Z" }),
            run("pullfrog", { status: "queued", conclusion: null, startedAt: null }),
            run("CodeRabbit", { status: "in_progress", conclusion: null }),
        ];
        expect(stateOf("pullfrog", runs)).toEqual({ kind: "reviewing" });
        expect(stateOf("coderabbit", runs)).toEqual({ kind: "reviewing" });
    });

    it("gives one state per configured bot, in the configuration's order", () => {
        expect(botStates(ALL_PASSED, prState(), CONFIG, NOW).map(({ bot }) => bot)).toEqual([
            "coderabbit",
            "greptile",
            "pullfrog",
        ]);
    });
});

describe("A review bot with no check run waits, then is not reviewing", () => {
    const withoutGreptile = ALL_PASSED.filter(({ name }) => name !== "Greptile Review");

    it("Within the wait: marked ready 12 minutes ago, with a wait of 30, Greptile is waiting", () => {
        const readyAt = minutesAfter(COMMITTED_AT, 60).toISOString();
        const now = minutesAfter(readyAt, 12);
        expect(stateOf("greptile", withoutGreptile, prState({ readyAt }), now)).toEqual({
            kind: "waiting",
            minutesLeft: 18,
        });
    });

    it("Wait run out: 31 minutes after a head commit later than the ready mark, Greptile is not reviewing for 30 minutes", () => {
        const readyAt = minutesAfter(COMMITTED_AT, -60).toISOString();
        const now = minutesAfter(COMMITTED_AT, 31);
        expect(stateOf("greptile", withoutGreptile, prState({ readyAt }), now)).toEqual({
            kind: "not-reviewing",
            reason: "no check run in 30 minutes",
        });
    });
});

describe("The checks of a pull request", () => {
    it("CI running: with `main` in progress the checks have not ended", () => {
        const runs = [...ALL_PASSED, run("main", { status: "in_progress", conclusion: null })];
        const checks = pullRequestChecks(runs, CONFIG.bots);
        expect(checks.ended).toBe(false);
        expect(checks.running.map(({ name }) => name)).toEqual(["main"]);
    });

    it("Bot check is not CI: a cancelled `pullfrog` run fails no check of the pull request", () => {
        const runs = ALL_PASSED.map((item) =>
            item.name === "pullfrog" ? run("pullfrog", { conclusion: "cancelled" }) : item,
        );
        const checks = pullRequestChecks(runs, CONFIG.bots);
        expect(checks).toEqual({ running: [], failed: [], ended: true });
    });

    it("a check that failed, timed out or was cancelled has failed; a skipped one has not", () => {
        const runs = [
            run("main", { conclusion: "failure" }),
            run("audit", { conclusion: "timed_out" }),
            run("Fallow", { conclusion: "cancelled" }),
            run("docs", { conclusion: "skipped" }),
        ];
        const failed = pullRequestChecks(runs, CONFIG.bots).failed.map(({ name }) => name);
        expect(failed).toEqual(["main", "audit", "Fallow"]);
    });
});
