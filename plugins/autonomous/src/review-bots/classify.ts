// A review bot's state for a head commit and the checks of a pull request (spec review-bots,
// "A review bot's state for a head commit", "A review bot with no check run waits, then is not
// reviewing" and "The checks of a pull request"; design D4). Pure: the clock is passed in.

import type { CheckRun, PullRequestState } from "../pull-request/port.ts";
import type { ExternalReviewConfig, ReviewBot } from "./types.ts";

export type BotState =
    | { kind: "reported" }
    | { kind: "reviewing" }
    | { kind: "waiting"; minutesLeft: number }
    | { kind: "not-reviewing"; reason: string };

export interface BotStatus {
    bot: string; // the review bot's id
    state: BotState;
}

export interface PullRequestChecks {
    running: CheckRun[]; // not completed
    failed: CheckRun[];
    ended: boolean; // no check is running
}

export const MINUTE_MS = 60_000;

const FAILED = new Set(["failure", "timed_out", "cancelled", "action_required", "startup_failure"]);

// A run with no start time is still queued, so it is newer than any run that started.
function startOf(run: CheckRun): number {
    return run.startedAt === null ? Number.POSITIVE_INFINITY : Date.parse(run.startedAt);
}

function latestRun(runs: readonly CheckRun[], name: string): CheckRun | null {
    let latest: CheckRun | null = null;
    for (const run of runs) {
        if (run.name === name && (latest === null || startOf(run) > startOf(latest))) {
            latest = run;
        }
    }
    return latest;
}

function stateOfRun(run: CheckRun): BotState {
    if (run.status !== "completed") {
        return { kind: "reviewing" };
    }
    if (run.conclusion === "success") {
        return { kind: "reported" };
    }
    const reason =
        run.title === null || run.title === "" ? `concluded ${run.conclusion}` : run.title;
    return { kind: "not-reviewing", reason };
}

// The committer time stands in for the push time, which GitHub does not expose (design D4).
function waitStart(state: PullRequestState): number {
    const committed = Date.parse(state.head.committedAt);
    return state.readyAt === null ? committed : Math.max(committed, Date.parse(state.readyAt));
}

function stateWithoutRun(state: PullRequestState, waitMinutes: number, now: Date): BotState {
    const left = waitStart(state) + waitMinutes * MINUTE_MS - now.getTime();
    return left > 0
        ? { kind: "waiting", minutesLeft: Math.ceil(left / MINUTE_MS) }
        : { kind: "not-reviewing", reason: `no check run in ${waitMinutes} minutes` };
}

// `runs` are the head commit's: a run on any other commit never counts.
export function botStates(
    runs: readonly CheckRun[],
    state: PullRequestState,
    config: Pick<ExternalReviewConfig, "waitMinutes" | "bots">,
    now: Date,
): BotStatus[] {
    return config.bots.map((bot) => {
        const run = latestRun(runs, bot.check);
        return {
            bot: bot.id,
            state: run === null ? stateWithoutRun(state, config.waitMinutes, now) : stateOfRun(run),
        };
    });
}

export function pullRequestChecks(
    runs: readonly CheckRun[],
    bots: readonly ReviewBot[],
): PullRequestChecks {
    const names = new Set(bots.map(({ check }) => check));
    const checks = runs.filter(({ name }) => !names.has(name));
    const running = checks.filter(({ status }) => status !== "completed");
    const failed = checks.filter(
        ({ status, conclusion }) =>
            status === "completed" && conclusion !== null && FAILED.has(conclusion),
    );
    return { running, failed, ended: running.length === 0 };
}
