import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { TaskRef } from "../attempts/record.ts";
import { writeRecord } from "../attempts/state.ts";
import { record, tempState } from "../attempts/test-fixtures.ts";
import { guardsOnLeaving } from "./guards.ts";
import { run } from "../review-bots/test-fixtures.ts";
import {
    BRANCH,
    CHANGE,
    type Reviewed,
    stateInReview,
    stateWithWorkspace,
    type Work,
    workTools,
} from "./test-fixtures.ts";

const TASK: TaskRef = { source: "linear", id: "DOT-121" };

const kept: string[] = [];

afterEach(() => {
    for (const directory of kept.splice(0)) {
        rmSync(directory, { recursive: true, force: true });
    }
});

async function leaving(
    work: Work = {},
    calls: string[] = [],
    stage: "implement" | "verify" | "code-review" = "implement",
): Promise<string[]> {
    const { state, workspace } = await stateWithWorkspace(TASK);
    kept.push(state, workspace);
    return guardsOnLeaving(stage, TASK, state, workTools(work, calls));
}

describe("guards: Leaving implement needs the work finished", () => {
    it("Unchecked task: the change and the count unchecked are named", async () => {
        expect(await leaving({ completed: 11, total: 12 })).toEqual([
            `the change ${CHANGE} has 1 of 12 tasks unchecked`,
        ]);
    });

    it("Uncommitted changes: the working tree is named", async () => {
        expect(await leaving({ status: " M src/a.ts\n?? src/b.ts\n" })).toEqual([
            "the working tree has 2 uncommitted changes",
        ]);
    });

    it("Unpushed commits: the count is named", async () => {
        expect(await leaving({ ahead: 2 })).toEqual([
            `the branch ${BRANCH} has 2 commits origin/${BRANCH} lacks`,
        ]);
    });

    it("No workspace: a task with no attempt has none to check", async () => {
        const state = tempState();
        kept.push(state);
        const calls: string[] = [];

        const reasons = await guardsOnLeaving("implement", TASK, state, workTools({}, calls));

        expect(reasons).toEqual(["there is no workspace to check: the task has no attempt"]);
        expect(calls).toEqual([]);
    });

    it("Work finished: every task checked, a clean working tree and a pushed branch pass", async () => {
        const calls: string[] = [];

        expect(await leaving({}, calls)).toEqual([]);
        expect(calls).toEqual([
            "git fetch --prune origin",
            `git merge-base origin/main HEAD`,
            "git diff --name-only --no-renames --diff-filter=A 5ca1ab1e HEAD -- openspec/changes/",
            "openspec list --json",
            "git status --porcelain --untracked-files=normal",
            `git rev-parse --verify --quiet origin/${BRANCH}`,
            `git rev-list --count origin/${BRANCH}..HEAD`,
        ]);
    });

    it("a released workspace has none to check: its path is gone", async () => {
        const { state, workspace } = await stateWithWorkspace(TASK);
        kept.push(state);
        rmSync(workspace, { recursive: true });
        const calls: string[] = [];

        const reasons = await guardsOnLeaving("implement", TASK, state, workTools({}, calls));

        expect(reasons).toEqual([`there is no workspace to check: ${workspace} no longer exists`]);
        expect(calls).toEqual([]);
    });

    it("a branch with no remote branch counts as unpushed", async () => {
        expect(await leaving({ remote: false })).toEqual([
            `the branch ${BRANCH} has no remote branch origin/${BRANCH}, so its commits are unpushed`,
        ]);
    });

    it("every reason that holds is reported, in the order of the spec", async () => {
        const reasons = await leaving({ completed: 3, total: 12, status: "?? a.ts\n", ahead: 1 });

        expect(reasons).toEqual([
            `the change ${CHANGE} has 9 of 12 tasks unchecked`,
            "the working tree has 1 uncommitted change",
            `the branch ${BRANCH} has 1 commit origin/${BRANCH} lacks`,
        ]);
    });

    it("a failed fetch is a reason, and the other checks still run", async () => {
        expect(await leaving({ fetchError: "git fetch: no network", status: "?? a.ts\n" })).toEqual(
            [
                "fetching origin in the workspace: git fetch: no network",
                "the working tree has 1 uncommitted change",
            ],
        );
    });

    // `attempt` counts per stage, so the proposal's 9 says nothing of which attempt is latest.
    it("the latest attempt of any stage holds the workspace, by creation time", async () => {
        const { state, workspace } = await stateWithWorkspace(TASK);
        kept.push(state, workspace);
        const { workspace: stale } = record();
        await writeRecord(
            state,
            record({
                id: "linear:DOT-121:proposal:9",
                task: { ...TASK, title: "Implementation stage" },
                stage: "proposal",
                attempt: 9,
                history: [{ state: "completed", at: "2026-01-01T00:00:00.000Z" }],
                workspace: { ...stale, path: join(state, "gone") },
            }),
        );

        expect(await guardsOnLeaving("implement", TASK, state, workTools())).toEqual([]);
    });

    it("the stages that have no guards pass without running a command", async () => {
        const state = tempState();
        kept.push(state);
        const calls: string[] = [];

        expect(await guardsOnLeaving("proposal", TASK, state, workTools({}, calls))).toEqual([]);
        expect(calls).toEqual([]);
    });
});

describe("guards: Leaving verify needs the work finished", () => {
    it("Uncommitted fix: the working tree is named", async () => {
        expect(await leaving({ status: " M src/a.ts\n" }, [], "verify")).toEqual([
            "the working tree has 1 uncommitted change",
        ]);
    });

    it("Unpushed fix: the count is named", async () => {
        expect(await leaving({ ahead: 1 }, [], "verify")).toEqual([
            `the branch ${BRANCH} has 1 commit origin/${BRANCH} lacks`,
        ]);
    });

    it("Work finished: every task checked, a clean working tree and a pushed branch pass", async () => {
        const calls: string[] = [];
        const reasons = await leaving({}, calls, "verify");
        const implementCalls: string[] = [];
        await leaving({}, implementCalls);

        expect(reasons).toEqual([]);
        expect(calls).toEqual(implementCalls);
        expect(calls).toContain("openspec list --json");
    });

    it("an unchecked task of the change is named, as for implement", async () => {
        expect(await leaving({ completed: 3, total: 4 }, [], "verify")).toEqual([
            `the change ${CHANGE} has 1 of 4 tasks unchecked`,
        ]);
    });
});

describe("guards: Leaving code-review needs the work finished", () => {
    it("Uncommitted fix: the working tree is named", async () => {
        expect(await leaving({ status: " M src/a.ts\n" }, [], "code-review")).toEqual([
            "the working tree has 1 uncommitted change",
        ]);
    });

    it("Unpushed fix: the commit the remote branch lacks is named", async () => {
        expect(await leaving({ ahead: 1 }, [], "code-review")).toEqual([
            `the branch ${BRANCH} has 1 commit origin/${BRANCH} lacks`,
        ]);
    });

    it("Unchecked task: every reason that holds comes back", async () => {
        expect(
            await leaving(
                { completed: 11, total: 12, status: " M a.ts\n", ahead: 2 },
                [],
                "code-review",
            ),
        ).toEqual([
            `the change ${CHANGE} has 1 of 12 tasks unchecked`,
            "the working tree has 1 uncommitted change",
            `the branch ${BRANCH} has 2 commits origin/${BRANCH} lacks`,
        ]);
    });

    it("Work finished: the three checks of verify run and pass", async () => {
        const calls: string[] = [];

        expect(await leaving({}, calls, "code-review")).toEqual([]);
        expect(calls).toHaveLength(7);
    });
});

describe("guards: Leaving external-review needs a quiet round", () => {
    async function rounding(reviewed: Reviewed = {}, work: Work = {}, calls: string[] = []) {
        const made = await stateInReview(TASK, {
            stage: "external-review",
            attempt: 2,
            quiet: true,
            ...reviewed,
        });
        kept.push(made.state, made.workspace);
        const reasons = await guardsOnLeaving(
            "external-review",
            TASK,
            made.state,
            workTools(work, calls),
        );
        return { ...made, reasons };
    }

    const notQuiet = (attempt: string, dir: string) =>
        `external-review attempt ${attempt} has a publish receipt at ${join(dir, "published.json")} ` +
        "that is not a quiet round's, so the external review is not over; leave the task to its next round, or discard the attempt";

    it("Round not quiet: the publish receipt is named", async () => {
        const { reasons, attempt, dir } = await rounding({ quiet: false });

        expect(reasons).toEqual([notQuiet(attempt, dir)]);
    });

    it("Check running: the check that has not ended is named", async () => {
        const { reasons } = await rounding(
            {},
            { checkRuns: [run("audit", { status: "in_progress", conclusion: null })] },
        );

        expect(reasons).toEqual(["the check audit has not ended on 0ddba11"]);
    });

    it("Quiet and green: a current quiet receipt, finished work and passed checks pass", async () => {
        const calls: string[] = [];
        const { reasons } = await rounding(
            {},
            { checkRuns: [run("main"), run("CodeRabbit", { status: "in_progress" })] },
            calls,
        );

        expect(reasons).toEqual([]);
        expect(calls.slice(-3)).toEqual([
            `pr find ${BRANCH}`,
            "pr state 7",
            "pr checkRuns 0ddba11",
        ]);
    });

    it("a failed check is named with its conclusion", async () => {
        const { reasons } = await rounding(
            {},
            { checkRuns: [run("main", { conclusion: "timed_out" })] },
        );

        expect(reasons).toEqual(["the check main concluded timed_out on 0ddba11"]);
    });

    it("no publish receipt, and a record changed after publishing, are named as for a code review", async () => {
        const missing = await rounding({ published: null });
        const changed = await rounding({ findings: "{}\n" });

        expect(missing.reasons).toEqual([
            `external-review attempt ${missing.attempt} has no publish receipt at ${join(missing.dir, "published.json")}, ` +
                `so its record is not published; publish it with --apply --publish ${missing.attempt}, or discard the attempt`,
        ]);
        expect(changed.reasons).toEqual([
            `external-review attempt ${changed.attempt} has a findings.json that differs from the one published, ` +
                `so its record is not published; publish it with --apply --publish ${changed.attempt}, or discard the attempt`,
        ]);
    });

    it("every reason that holds comes back: the work, the receipt and the checks", async () => {
        const { reasons, attempt, dir } = await rounding(
            { quiet: false },
            {
                ahead: 1,
                checkRuns: [
                    run("main", { conclusion: "failure" }),
                    run("audit", { status: "queued", conclusion: null }),
                ],
            },
        );

        expect(reasons).toEqual([
            `the branch ${BRANCH} has 1 commit origin/${BRANCH} lacks`,
            notQuiet(attempt, dir),
            "the check main concluded failure on 0ddba11",
            "the check audit has not ended on 0ddba11",
        ]);
    });

    it("a publish receipt that cannot be read and check runs that cannot be read are reasons", async () => {
        const made = await stateInReview(TASK, { stage: "external-review", quiet: true });
        kept.push(made.state, made.workspace);
        writeFileSync(join(made.dir, "published.json"), "not json");

        const reasons = await guardsOnLeaving(
            "external-review",
            TASK,
            made.state,
            workTools({ checkRunsError: "HTTP 500" }),
        );

        expect(reasons).toHaveLength(2);
        expect(reasons[0]).toContain("is not valid JSON");
        expect(reasons[1]).toBe("cannot read the check runs of pull request #7: HTTP 500");
    });

    it("a task with no open attempt of the stage is checked for its work and its checks only", async () => {
        const { reasons } = await (async () => {
            const { state, workspace } = await stateWithWorkspace(TASK);
            kept.push(state, workspace);
            return { reasons: await guardsOnLeaving("external-review", TASK, state, workTools()) };
        })();

        expect(reasons).toEqual([]);
    });
});
