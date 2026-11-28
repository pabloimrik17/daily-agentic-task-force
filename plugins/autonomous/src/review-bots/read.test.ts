import { describe, expect, it } from "vitest";

import type { PullRequests } from "../pull-request/port.ts";
import { readExternalReview } from "./read.ts";
import {
    ALL_PASSED,
    COMMITTED_AT,
    CONFIG,
    HEAD,
    comment,
    minutesAfter,
    prState,
    review,
    thread,
} from "./test-fixtures.ts";

type Reads = Pick<PullRequests, "state" | "checkRuns" | "threads" | "reviews">;

function fakePullRequests(reads: Partial<Reads>, calls: string[]): PullRequests {
    const port: Reads = {
        state: (number) => {
            calls.push(`state ${number}`);
            return reads.state?.(number) ?? Promise.resolve({ ok: true, value: prState() });
        },
        checkRuns: (sha) => {
            calls.push(`checkRuns ${sha}`);
            return reads.checkRuns?.(sha) ?? Promise.resolve({ ok: true, value: ALL_PASSED });
        },
        threads: (number) => {
            calls.push(`threads ${number}`);
            return reads.threads?.(number) ?? Promise.resolve({ ok: true, value: [] });
        },
        reviews: (number) => {
            calls.push(`reviews ${number}`);
            return reads.reviews?.(number) ?? Promise.resolve({ ok: true, value: [] });
        },
    };
    // The reader calls nothing else; any other method failing loudly would be the test's failure.
    return port as PullRequests;
}

const NOW = minutesAfter(COMMITTED_AT, 40);

describe("readExternalReview", () => {
    it("reads the state, then the head commit's check runs, the threads and the reviews, and returns all of it", async () => {
        const calls: string[] = [];
        const open = thread([comment("coderabbitai", "Major: a bug")]);
        const port = fakePullRequests(
            {
                threads: () => Promise.resolve({ ok: true, value: [open] }),
                reviews: () =>
                    Promise.resolve({
                        ok: true,
                        value: [review("coderabbitai[bot]", "Actionable: 1")],
                    }),
            },
            calls,
        );
        const read = await readExternalReview(port, 7, CONFIG, NOW);
        expect(calls).toEqual(["state 7", `checkRuns ${HEAD}`, "threads 7", "reviews 7"]);
        expect(read.ok).toBe(true);
        if (!read.ok) {
            return;
        }
        expect(read.value).toMatchObject({
            number: 7,
            draft: false,
            head: HEAD,
            checks: { ended: true, failed: [], running: [] },
            settled: { settled: true, reasons: [] },
        });
        expect(read.value.bots.map(({ state }) => state.kind)).toEqual([
            "reported",
            "reported",
            "reported",
        ]);
        expect(read.value.report.findings).toHaveLength(1);
        expect(read.value.report.bodies).toHaveLength(1);
        expect(read.value.report.quiet).toBe(false);
    });

    it("reports a draft as not settled", async () => {
        const port = fakePullRequests(
            { state: () => Promise.resolve({ ok: true, value: prState({ draft: true }) }) },
            [],
        );
        const read = await readExternalReview(port, 7, CONFIG, NOW);
        expect(read.ok && read.value.settled).toEqual({
            settled: false,
            reasons: ["the pull request is a draft"],
        });
    });

    it("fails naming the read that failed, and reads nothing after a failed state", async () => {
        const calls: string[] = [];
        const noState = fakePullRequests(
            { state: () => Promise.resolve({ ok: false, error: "gh: not found" }) },
            calls,
        );
        expect(await readExternalReview(noState, 7, CONFIG, NOW)).toEqual({
            ok: false,
            error: "cannot read the state of pull request #7: gh: not found",
        });
        expect(calls).toEqual(["state 7"]);
        const noRuns = fakePullRequests(
            { checkRuns: () => Promise.resolve({ ok: false, error: "rate limit" }) },
            [],
        );
        expect(await readExternalReview(noRuns, 7, CONFIG, NOW)).toEqual({
            ok: false,
            error: "cannot read the check runs of pull request #7: rate limit",
        });
    });
});
