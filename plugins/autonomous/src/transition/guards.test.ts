import { rmSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { TaskRef } from "../attempts/record.ts";
import { writeRecord } from "../attempts/state.ts";
import { record, tempState } from "../attempts/test-fixtures.ts";
import { guardsOnLeaving } from "./guards.ts";
import { BRANCH, CHANGE, stateWithWorkspace, type Work, workTools } from "./test-fixtures.ts";

const TASK: TaskRef = { source: "linear", id: "DOT-121" };

const kept: string[] = [];

afterEach(() => {
    for (const directory of kept.splice(0)) {
        rmSync(directory, { recursive: true, force: true });
    }
});

async function leaving(work: Work = {}, calls: string[] = []): Promise<string[]> {
    const { state, workspace } = await stateWithWorkspace(TASK);
    kept.push(state, workspace);
    return guardsOnLeaving("implement", TASK, state, workTools(work, calls));
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
