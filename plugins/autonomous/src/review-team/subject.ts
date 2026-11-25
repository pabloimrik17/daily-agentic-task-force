// The subject of a review (spec review-team, "The subject of a review"; design
// D5): committed work from the merge base with the base to HEAD. The base is
// the one given, else the open pull request's, else the default branch's.
// Every git call runs in the repository: the caller binds the Exec to it.

import { createHash } from "node:crypto";
import { basename, isAbsolute, relative, sep } from "node:path";

import type { Exec } from "../exec.ts";
import type { Result } from "../result.ts";
import type { Subject } from "./types.ts";

interface SubjectDeps {
    git: Exec;
    gh: Exec;
    repoRoot: string;
    leaveOut?: string; // a path from the repository root that is not part of the tree's state
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
async function mergeBaseWith(git: Exec, base: string, head: string): Promise<Result<string>> {
    const remote = await git(["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${base}`]);
    const ref = remote.ok ? `origin/${base}` : base;
    const mergeBase = await stdoutOf(git, ["merge-base", ref, head]);
    return mergeBase.ok
        ? mergeBase
        : { ok: false, error: `finding the merge base of HEAD and ${ref}: ${mergeBase.error}` };
}

// The path of `dir` from the repository root, when `dir` is inside the repository.
export function insideRepository(root: string, dir: string): string | undefined {
    const path = relative(root, dir);
    const outside = path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path);
    return path === "" || outside ? undefined : path;
}

// `literal`, so a directory name holding `*`, `?` or `[` is not read as a glob.
function pathspec(leaveOut?: string): string[] {
    return leaveOut === undefined ? [] : ["--", ".", `:(exclude,literal)${leaveOut}`];
}

// `leaveOut`: the report directory, written after the plan and never a change of the tree.
export async function gitStatus(git: Exec, leaveOut?: string): Promise<Result<string>> {
    // Explicit, so status.showUntrackedFiles=no cannot hide new files.
    const status = await git([
        "status",
        "--porcelain",
        "--untracked-files=normal",
        ...pathspec(leaveOut),
    ]);
    return status.ok ? { ok: true, value: status.stdout } : status;
}

// The untracked files' blob ids, read without writing an object. None: no call.
async function untrackedBlobs(git: Exec, names: string): Promise<Result<string>> {
    const paths = names.split("\0").filter((name) => name !== "");
    if (paths.length === 0) {
        return { ok: true, value: "" };
    }
    const blobs = await git(["hash-object", "--stdin-paths"], `${paths.join("\n")}\n`);
    return blobs.ok ? { ok: true, value: blobs.stdout } : blobs;
}

// A digest of the working tree's contents: the status line of a file already dirty at plan
// time stays the same when it is edited again, its contents do not.
export async function treeFingerprint(git: Exec, leaveOut?: string): Promise<Result<string>> {
    const diff = await git([
        "diff",
        "HEAD",
        "--binary",
        "--no-color",
        "--no-ext-diff",
        "--no-textconv",
        ...pathspec(leaveOut),
    ]);
    if (!diff.ok) {
        return diff;
    }
    const names = await git([
        "ls-files",
        "--others",
        "--exclude-standard",
        "-z",
        ...pathspec(leaveOut),
    ]);
    if (!names.ok) {
        return names;
    }
    const blobs = await untrackedBlobs(git, names.stdout);
    if (!blobs.ok) {
        return blobs;
    }
    const hash = createHash("sha256");
    for (const part of [diff.stdout, names.stdout, blobs.value]) {
        hash.update(part).update("\0");
    }
    return { ok: true, value: hash.digest("hex") };
}

async function headState(
    git: Exec,
    leaveOut?: string,
): Promise<Result<Pick<Subject, "branch" | "head" | "dirty">>> {
    const branch = await stdoutOf(git, ["rev-parse", "--abbrev-ref", "HEAD"]);
    if (!branch.ok) {
        return branch;
    }
    const head = await stdoutOf(git, ["rev-parse", "HEAD"]);
    if (!head.ok) {
        return head;
    }
    const status = await gitStatus(git, leaveOut);
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
    // One observation of HEAD: the merge base is derived from that commit.
    const state = await headState(deps.git, deps.leaveOut);
    if (!state.ok) {
        return state;
    }
    const mergeBase = await mergeBaseWith(deps.git, resolved.value.base, state.value.head);
    if (!mergeBase.ok) {
        return mergeBase;
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
