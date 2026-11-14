// The pull requests of a task's branch (spec stage-logbook; design D2): one implementation over
// `git` and `gh`, fakes in tests. Every command runs in the one directory the port was made for:
// the attempt's worktree, or the repository when the worktree may be gone (discard).

import type { Result } from "../result.ts";

// The subject of the empty commit pull-request mode adds is this prefix and the task id.
export const EMPTY_COMMIT_SUBJECT = "chore: open the pull request of ";

export interface PullRequest {
    number: number;
    url: string;
    title: string;
}

export interface OpenRequest {
    base: string;
    branch: string;
    title: string;
    bodyFile: string;
}

export interface PullRequests {
    defaultBranch(): Promise<Result<string>>;
    find(branch: string): Promise<Result<PullRequest | null>>; // the open one; merged and closed ones never count
    ahead(base: string): Promise<Result<number>>; // commits on HEAD that origin/<base> lacks, after fetching it
    commitsSince(base: string, since: string): Promise<Result<string[]>>; // short ids on HEAD, not on origin/<base>, without the empty commit of pull-request mode
    emptyCommit(message: string): Promise<Result<void>>;
    push(branch: string): Promise<Result<void>>; // never forced; hooks run
    open(request: OpenRequest): Promise<Result<PullRequest>>; // always a draft
    edit(number: number, change: { title?: string; bodyFile: string }): Promise<Result<void>>;
    comment(number: number, file: string): Promise<Result<void>>;
    comments(number: number): Promise<Result<string[]>>; // bodies, oldest first
}

export type PullRequestsFactory = (directory: string) => PullRequests;
