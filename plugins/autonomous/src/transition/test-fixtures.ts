import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AttemptRecord, TaskRef } from "../attempts/record.ts";
import { writeRecord } from "../attempts/state.ts";
import { record, tempState } from "../attempts/test-fixtures.ts";
import type { ExecResult } from "../exec.ts";
import type { PullRequests } from "../pull-request/port.ts";
import type { GuardTools } from "./guards.ts";

export const BRANCH = "feature/DOT-110-implement-stage";

export const CHANGE = "add-implementation-stage";

const fail = (error: string): ExecResult => ({ ok: false, error });

// Guards that run no command: for a transition the guards never reach.
export const NO_TOOLS: GuardTools = {
    git: () => Promise.resolve(fail("unused")),
    openspecIn: () => () => Promise.resolve(fail("unused")),
    pullRequests: () => {
        throw new Error("no pull requests were expected");
    },
};

// What the workspace holds; the defaults are finished work.
export interface Work {
    completed?: number;
    total?: number;
    status?: string; // `git status --porcelain`
    remote?: boolean; // whether origin/<branch> exists
    ahead?: number;
    fetchError?: string;
}

// Fake git and openspec execs that answer by their arguments and log "<command> <arguments>".
export function workTools(work: Work = {}, calls: string[] = []): GuardTools {
    const { completed = 12, total = 12, status = "", remote = true, ahead = 0 } = work;
    const git = (args: string[]): Promise<ExecResult> => {
        calls.push(`git ${args.slice(2).join(" ")}`);
        const [verb] = args.slice(2);
        const answers: Record<string, ExecResult> = {
            fetch: work.fetchError === undefined ? { ok: true, stdout: "" } : fail(work.fetchError),
            "merge-base": { ok: true, stdout: "5ca1ab1e\n" },
            diff: { ok: true, stdout: `openspec/changes/${CHANGE}/proposal.md\n` },
            status: { ok: true, stdout: status },
            "rev-parse": remote ? { ok: true, stdout: "0ddba11\n" } : fail("unknown revision"),
            "rev-list": { ok: true, stdout: `${ahead}\n` },
        };
        return Promise.resolve(answers[verb ?? ""] ?? fail(`git ${verb} was not expected`));
    };
    const listing = JSON.stringify({
        changes: [{ name: CHANGE, completedTasks: completed, totalTasks: total }],
    });
    return {
        git,
        openspecIn: () => (args) => {
            calls.push(`openspec ${args.join(" ")}`);
            return Promise.resolve({ ok: true, stdout: listing });
        },
        pullRequests: () =>
            ({
                defaultBranch: () => Promise.resolve({ ok: true, value: "main" }),
            }) as PullRequests,
    };
}

// A state directory with one attempt of the task, whose workspace is a directory that exists. The
// attempt is completed, so it holds no task and awaits no receipt.
export async function stateWithWorkspace(
    task: TaskRef,
    overrides: Partial<AttemptRecord> = {},
): Promise<{ state: string; workspace: string }> {
    const state = tempState();
    const workspace = mkdtempSync(join(tmpdir(), "autonomous-workspace-"));
    const id = `${task.source}:${task.id}:implement:1` as const;
    await writeRecord(
        state,
        record({
            id,
            task: { ...task, title: "Implementation stage" },
            stage: "implement",
            state: "completed",
            workspace: {
                manager: "worktrunk",
                repository: "/w/dotfiles",
                inferredFrom: "project Dotfiles",
                branch: BRANCH,
                path: workspace,
            },
            ...overrides,
        }),
    );
    return { state, workspace };
}
