// The variants of the shared pieces only the implementation stage uses; proposal.test.ts covers
// the rest through proposal preparation.

import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { PullRequest, PullRequests } from "../pull-request/port.ts";
import type { Result } from "../result.ts";
import { workTask } from "../select/test-fixtures.ts";
import { codeReviewStage } from "./code-review/stage.ts";
import { implementStage } from "./implement/stage.ts";
import {
    afkTransition,
    blockedSection,
    changeCheck,
    type Check,
    commitsSection,
    constraintsSection,
    DEVIATION,
    hitlTransition,
    openspecChecks,
    orchestrationSection,
    type Paths,
    PULL_REQUEST_KEY,
} from "./openspec-stage.ts";
import { proposalStage } from "./proposal/stage.ts";
import type { StageContext } from "./stage.ts";
import { stageEnv } from "./test-fixtures.ts";
import { verifyStage } from "./verify/stage.ts";

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
    return lookUpAs({ ok: true, value: found });
}

function lookUpAs(found: Result<PullRequest | null>): Promise<Result<StageContext>> {
    const find: PullRequests["find"] = () => Promise.resolve(found);
    const env = stageEnv({ branch: BRANCH });
    return pullRequestCheck("required")(
        {
            ...env,
            readers: {
                ...env.readers,
                pullRequests: { find } as Partial<PullRequests> as PullRequests,
            },
        },
        {},
    );
}

describe("repository prerequisites of the OpenSpec stages", () => {
    let repository: string;

    beforeEach(() => {
        repository = mkdtempSync(join(tmpdir(), "openspec-repository-"));
    });

    afterEach(async () => {
        chmodSync(repository, 0o700);
        await rm(repository, { recursive: true, force: true });
    });

    const OPENSPEC_STAGES = [proposalStage, implementStage, verifyStage, codeReviewStage];

    it.each(OPENSPEC_STAGES.map((stage) => [stage.id, stage] as const))(
        "OpenSpec stages: %s fails naming the repository and the missing OpenSpec root",
        async (_, stage) => {
            expect(await stage.repositoryPrerequisites?.(repository)).toEqual({
                ok: false,
                reason: `the repository ${repository} has no OpenSpec root: ${join(repository, "openspec")} is not a directory`,
            });
        },
    );

    it.each(OPENSPEC_STAGES.map((stage) => [stage.id, stage] as const))(
        "%s fails, not as unreadable, when openspec is a file",
        async (_, stage) => {
            writeFileSync(join(repository, "openspec"), "x\n");

            const held = await stage.repositoryPrerequisites?.(repository);

            expect(held).toMatchObject({ ok: false });
            expect(held).not.toHaveProperty("unreadable");
        },
    );

    it.each(OPENSPEC_STAGES.map((stage) => [stage.id, stage] as const))(
        "OpenSpec root cannot be read: %s fails as unreadable with the read error",
        async (_, stage) => {
            mkdirSync(join(repository, "openspec"));
            chmodSync(repository, 0o000);

            expect(await stage.repositoryPrerequisites?.(repository)).toEqual({
                ok: false,
                reason: expect.stringMatching(
                    new RegExp(
                        `^the OpenSpec root ${join(repository, "openspec")} of ${repository} cannot be read: .*EACCES`,
                    ),
                ) as string,
                unreadable: true,
            });
        },
    );

    it("OpenSpec root cannot be read: the stage's prerequisites fail as unreadable too", async () => {
        mkdirSync(join(repository, "openspec"));
        chmodSync(repository, 0o000);
        const task = workTask("linear", "DOT-1", ["personal", "AFK", "implement"]);

        expect(await implementStage.prerequisites(stageEnv({ repository, task }))).toMatchObject({
            ok: false,
            reason: expect.stringContaining("cannot be read") as string,
            unreadable: true,
        });
    });

    it.each(OPENSPEC_STAGES.map((stage) => [stage.id, stage] as const))(
        "%s holds once the repository has an OpenSpec root",
        async (_, stage) => {
            mkdirSync(join(repository, "openspec"));

            expect(await stage.repositoryPrerequisites?.(repository)).toEqual({ ok: true });
        },
    );
});

describe("required pull request", () => {
    it("No pull request: the reason names the branch", async () => {
        expect(await lookUp(null)).toEqual({
            ok: false,
            error: `the workspace branch ${BRANCH} has no open pull request`,
        });
    });

    it("Lookup fails: unreadable, naming the branch", async () => {
        expect(await lookUpAs({ ok: false, error: "gh failed: HTTP 502" })).toEqual({
            ok: false,
            error: `cannot look up the open pull request of ${BRANCH}: gh failed: HTTP 502`,
            unreadable: true,
        });
    });

    it("Pull request open: the context holds it", async () => {
        expect(await lookUp(PULL_REQUEST)).toEqual({
            ok: true,
            value: { [PULL_REQUEST_KEY]: JSON.stringify(PULL_REQUEST) },
        });
    });
});

describe("the change check", () => {
    it("Default branch cannot be read: unreadable, naming the repository", async () => {
        const defaultBranch: PullRequests["defaultBranch"] = () =>
            Promise.resolve({ ok: false, error: "gh failed: HTTP 502" });
        const env = stageEnv({ branch: BRANCH });

        const found = await changeCheck(
            {
                ...env,
                readers: {
                    ...env.readers,
                    pullRequests: { defaultBranch } as Partial<PullRequests> as PullRequests,
                },
            },
            {},
        );

        expect(found).toEqual({
            ok: false,
            error: `cannot read the default branch of ${env.repository}: gh failed: HTTP 502`,
            unreadable: true,
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

const verifyPaths: Paths = {
    attempt: "linear:DOT-121:verify:1",
    task: "linear:DOT-121",
    summary: "/state/stage-summary.md",
    entry: "/state/logbook-entry.md",
};

describe("orchestration section", () => {
    it("what each teammate works on and what ends reach the text", () => {
        const { title, lines } = orchestrationSection({
            each: "a phase of the adversarial review",
            ends: "the verification ends",
        });

        expect(title).toBe("Orchestration");
        expect(lines.join("\n")).toContain("each on a phase of the adversarial review.");
        expect(lines.join("\n")).toContain("until the verification ends:");
    });
});

describe("commits section", () => {
    it("the unit committed and what the push precedes reach the text", () => {
        const { title, lines } = commitsSection({
            unit: "each fixed finding on its own: its fix, and its reproduction test when it has one",
            next: "the next fix",
        });

        expect(title).toBe("Commits");
        expect(lines).toContain(
            "- Commit each fixed finding on its own: its fix, and its reproduction test when it has one, in the same commit. Stage by path, never with `git add -A` or `git add .`, so no other file reaches the commit.",
        );
        expect(lines).toContain(
            "- Push each commit before you start the next fix, so the pull request always shows the work done.",
        );
    });
});

describe("transition steps", () => {
    const move = { left: "verify", reached: "code-review" } as const;

    it("AFK: names the stage left and the stage reached", () => {
        const text = afkTransition(verifyPaths, move);

        expect(text).toContain("moves the task to `code-review` itself");
        expect(text).toContain("labels it lists show `code-review` and no `verify`");
        expect(text).toContain("the task stays in `verify`");
        expect(text).toContain("--transition linear:DOT-121 --from verify`");
        expect(text).toContain("refused because the task is no longer in `verify`");
        expect(text).toContain("--log linear:DOT-121:verify:1`");
        expect(text).not.toContain("implement");
    });

    it("HITL: names the stage reached and what the human approves", () => {
        const text = hitlTransition(verifyPaths, move, "the verification");

        expect(text).toContain(
            "asks the human whether to approve the verification and move the task to `code-review`",
        );
        expect(text).toContain("--transition linear:DOT-121 --from verify`");
        expect(text).not.toContain("implement");
    });
});

describe("deviation rule", () => {
    it("holds one sentence per autonomy", () => {
        expect(DEVIATION.AFK).toBe(
            "Decide the deviation yourself, without asking, and record it as an assumption as well.",
        );
        expect(DEVIATION.HITL).toBe(
            "Ask the human before you change the proposal, and change it only as they decide.",
        );
    });
});

describe("constraints section", () => {
    it("the failure handling and what the stage writes reach the text", () => {
        const { title, lines } = constraintsSection(
            "tell the human what it reported",
            "the commits, the change's artifacts, any follow-up task",
        );

        expect(title).toBe("Constraints");
        expect(lines).toContain("- If a push fails, tell the human what it reported.");
        expect(lines.at(-1)).toContain(
            "in the commits, the change's artifacts, any follow-up task, the stage summary or the logbook entry",
        );
    });
});
