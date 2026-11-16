// The variants of the shared pieces only the implementation stage uses; proposal.test.ts covers
// the rest through proposal preparation.

import { describe, expect, it } from "vitest";

import type { PullRequest, PullRequests } from "../pull-request/port.ts";
import type { Result } from "../result.ts";
import { blockedSection, type Check, openspecChecks, PULL_REQUEST_KEY } from "./openspec-stage.ts";
import type { StageContext } from "./stage.ts";
import { stageEnv } from "./test-fixtures.ts";

const BRANCH = "feature/DOT-121-login-fix";

const PULL_REQUEST: PullRequest = {
    number: 90,
    url: "https://github.com/demo/repo/pull/90",
    title: "feat: read GitHub blockers (DOT-121)",
};

// The pull-request check, the last of the shared ones, run alone.
function pullRequestCheck(pullRequest: "required" | "optional"): Check {
    const check = openspecChecks({ stage: "implement", workflows: {}, pullRequest }).at(-1);
    if (check === undefined) {
        throw new Error("openspecChecks returned no check");
    }
    return check;
}

function lookUp(found: PullRequest | null): Promise<Result<StageContext>> {
    const find: PullRequests["find"] = () => Promise.resolve({ ok: true, value: found });
    const env = stageEnv({ branch: BRANCH });
    return pullRequestCheck("required")({
        ...env,
        readers: {
            ...env.readers,
            pullRequests: { find } as Partial<PullRequests> as PullRequests,
        },
    });
}

describe("required pull request", () => {
    it("No pull request: the reason names the branch", async () => {
        expect(await lookUp(null)).toEqual({
            ok: false,
            error: `the workspace branch ${BRANCH} has no open pull request`,
        });
    });

    it("Pull request open: the context holds it", async () => {
        expect(await lookUp(PULL_REQUEST)).toEqual({
            ok: true,
            value: { [PULL_REQUEST_KEY]: JSON.stringify(PULL_REQUEST) },
        });
    });
});

describe("blocked path with a pull request", () => {
    const paths = {
        attempt: "linear:DOT-121:implement:1",
        task: "linear:DOT-121",
        summary: "/state/stage-summary.md",
        entry: "/state/logbook-entry.md",
    } as const;

    const { lines } = blockedSection(paths, {
        stage: "implement",
        when: "When you cannot finish the implementation. Instead:",
        steps: ["Commit and push what is done."],
        blocks: "the implementation",
        pullRequest: "always",
    });

    it("puts the stage's own steps first and always publishes the entry", () => {
        expect(lines.slice(2)).toEqual([
            "1. Commit and push what is done.",
            "2. Write the stage summary to `/state/stage-summary.md`: what blocks the implementation, what you found, and what a human must decide. Then run `/autonomous:run --apply --persist linear:DOT-121:implement:1`, which posts it on the task.",
            "3. Write a logbook entry to `/state/logbook-entry.md` that says the attempt is blocked and why, then run `/autonomous:run --apply --log linear:DOT-121:implement:1`.",
            "4. Run no transition and write no result marker, then stop. The task stays in `implement`, and the attempt is kept once this session ends, so a human finds it with your explanation.",
        ]);
    });
});
