// The worktrunk adapter (design D4): `prepare` makes or reuses the worktree of a
// task branch, `release` removes the worktree and keeps the branch. Hooks run as
// the user configured them; hook chatter goes to stderr, so stdout is only JSON.

import { stat } from "node:fs/promises";

import { type Exec, execCommand } from "../exec.ts";
import type { Result } from "../result.ts";
import type { WorkspaceManager, WorkspaceManagerFactory } from "./manager.ts";

export const WORKSPACE_TIMEOUT_MS = 120_000;

interface Prepared {
    path: string;
    created: boolean;
}

// The one JSON object `wt switch --format=json` prints: `path`, and `action`
// ("created" for a new branch, "existing" otherwise).
function parseSwitch(stdout: string): Result<Prepared> {
    let parsed: unknown;
    try {
        parsed = JSON.parse(stdout);
    } catch (error) {
        return {
            ok: false,
            error: `wt switch: output is not valid JSON: ${(error as Error).message}`,
        };
    }
    const { path, action } = (parsed ?? {}) as { path?: unknown; action?: unknown };
    if (typeof path !== "string" || path === "") {
        return { ok: false, error: "wt switch: output has no path" };
    }
    if (action !== "created" && action !== "existing") {
        return { ok: false, error: `wt switch: unexpected action ${JSON.stringify(action)}` };
    }
    return { ok: true, value: { path, created: action === "created" } };
}

async function isDirectory(path: string): Promise<boolean> {
    try {
        return (await stat(path)).isDirectory();
    } catch {
        return false;
    }
}

export function worktrunkManager(wt: Exec, git: Exec): WorkspaceManager {
    return {
        async prepare(repository, branch) {
            // Exec cannot tell a missing ref (exit 1) from any other git failure, so every
            // failure reads as "the branch does not exist"; if that is wrong, `wt switch
            // --create` refuses an existing branch and its error names the cause.
            const probe = await git([
                "-C",
                repository,
                "rev-parse",
                "--verify",
                "--quiet",
                `refs/heads/${branch}`,
            ]);
            const switched = await wt([
                "-C",
                repository,
                "switch",
                ...(probe.ok ? [] : ["--create"]),
                branch,
                "--no-cd",
                "--format=json",
            ]);
            if (!switched.ok) {
                return { ok: false, error: `wt switch: ${switched.error}` };
            }
            const prepared = parseSwitch(switched.stdout);
            if (prepared.ok && !(await isDirectory(prepared.value.path))) {
                return {
                    ok: false,
                    error: `wt switch: path ${prepared.value.path} does not exist`,
                };
            }
            return prepared;
        },
        async release(repository, branch) {
            // --no-delete-branch: `wt remove` deletes a merged branch otherwise, and a branch is
            // never deleted here. --foreground makes the exit mean the removal is done.
            const removed = await wt([
                "-C",
                repository,
                "remove",
                branch,
                "--no-delete-branch",
                "--foreground",
                "--format=json",
            ]);
            return removed.ok
                ? { ok: true, value: undefined }
                : { ok: false, error: `wt remove: ${removed.error}` };
        },
    };
}

export const worktrunkWorkspace: WorkspaceManagerFactory = () =>
    worktrunkManager(execCommand("wt", WORKSPACE_TIMEOUT_MS), execCommand("git"));
