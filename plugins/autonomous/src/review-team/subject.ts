// The subject of a review (spec review-team, "The subject of a review"; design
// D5): committed work from the merge base with the base to HEAD. The base is
// the one given, else the open pull request's, else the default branch's.
// Every git call runs in the repository: the caller binds the Exec to it.

import { basename } from "node:path";

import type { Exec } from "../exec.ts";
import type { Result } from "../result.ts";
import type { Subject } from "./types.ts";

interface SubjectDeps {
    git: Exec;
    gh: Exec;
    repoRoot: string;
}

type Base = Pick<Subject, "base" | "baseSource">;

async function stdoutOf(exec: Exec, args: string[]): Promise<Result<string>> {
    const result = await exec(args);
    return result.ok ? { ok: true, value: result.stdout.trim() } : result;
}

function openBase(stdout: string): string | undefined {
    try {
        const pr = JSON.parse(stdout) as { baseRefName?: unknown; state?: unknown };
        return pr.state === "OPEN" && typeof pr.baseRefName === "string" && pr.baseRefName !== ""
            ? pr.baseRefName
            : undefined;
    } catch {
        return undefined;
    }
}

// Any failure, no pull request, or one that is not open falls through to the default branch.
async function pullRequestBase(gh: Exec): Promise<string | undefined> {
    const view = await gh(["pr", "view", "--json", "baseRefName,state"]);
    return view.ok ? openBase(view.stdout) : undefined;
}

async function defaultBranch(git: Exec): Promise<Result<string>> {
    const head = await stdoutOf(git, ["symbolic-ref", "refs/remotes/origin/HEAD"]);
    if (!head.ok) {
        return { ok: false, error: `no base given, no open pull request, and ${head.error}` };
    }
    return { ok: true, value: head.value.replace(/^refs\/remotes\/origin\//, "") };
}

async function resolveBase(deps: SubjectDeps, given?: string): Promise<Result<Base>> {
    if (given !== undefined) {
        return { ok: true, value: { base: given, baseSource: "given" } };
    }
    const fromPullRequest = await pullRequestBase(deps.gh);
    if (fromPullRequest !== undefined) {
        return { ok: true, value: { base: fromPullRequest, baseSource: "pull-request" } };
    }
    const fallback = await defaultBranch(deps.git);
    return fallback.ok
        ? { ok: true, value: { base: fallback.value, baseSource: "default-branch" } }
        : fallback;
}

// The remote-tracking ref when it exists, so a stale local branch does not move the merge base.
async function mergeBaseWith(git: Exec, base: string): Promise<Result<string>> {
    const remote = await git(["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${base}`]);
    const ref = remote.ok ? `origin/${base}` : base;
    const mergeBase = await stdoutOf(git, ["merge-base", ref, "HEAD"]);
    return mergeBase.ok
        ? mergeBase
        : { ok: false, error: `finding the merge base of HEAD and ${ref}: ${mergeBase.error}` };
}

export async function gitStatus(git: Exec): Promise<Result<string>> {
    const status = await git(["status", "--porcelain"]);
    return status.ok ? { ok: true, value: status.stdout } : status;
}

async function headState(git: Exec): Promise<Result<Pick<Subject, "branch" | "head" | "dirty">>> {
    const branch = await stdoutOf(git, ["rev-parse", "--abbrev-ref", "HEAD"]);
    if (!branch.ok) {
        return branch;
    }
    const head = await stdoutOf(git, ["rev-parse", "HEAD"]);
    if (!head.ok) {
        return head;
    }
    const status = await gitStatus(git);
    if (!status.ok) {
        return status;
    }
    return {
        ok: true,
        value: { branch: branch.value, head: head.value, dirty: status.value.trim() !== "" },
    };
}

export async function resolveSubject(deps: SubjectDeps, base?: string): Promise<Result<Subject>> {
    const resolved = await resolveBase(deps, base);
    if (!resolved.ok) {
        return resolved;
    }
    const mergeBase = await mergeBaseWith(deps.git, resolved.value.base);
    if (!mergeBase.ok) {
        return mergeBase;
    }
    const state = await headState(deps.git);
    if (!state.ok) {
        return state;
    }
    return {
        ok: true,
        value: {
            repo: basename(deps.repoRoot),
            branch: state.value.branch,
            ...resolved.value,
            mergeBase: mergeBase.value,
            head: state.value.head,
            dirty: state.value.dirty,
        },
    };
}
