// Every command runs in the one directory the port was made for:
// the attempt's worktree, or the repository when the worktree may be gone (discard).

import type { Result } from "../result.ts";

export const EMPTY_COMMIT_SUBJECT = "chore: open the pull request of ";

export interface PullRequest {
    number: number;
    url: string;
    title: string;
}

interface OpenRequest {
    base: string;
    branch: string;
    title: string;
    bodyFile: string;
}

// Review threads exist only in GitHub's GraphQL API (design D8 of add-code-review-stage).
export type DiffSide = "LEFT" | "RIGHT";

export interface ThreadComment {
    id: string; // GraphQL node id
    body: string;
    url: string;
    author: string; // login; empty when the account is gone
    createdAt: string; // ISO 8601
}

export interface ReviewThread {
    id: string; // GraphQL node id
    path: string;
    subjectType: "LINE" | "FILE";
    line: number | null; // null at file level, or when GitHub no longer places it
    startLine: number | null;
    side: DiffSide | null;
    resolved: boolean;
    outdated: boolean;
    comments: ThreadComment[]; // oldest first; the first one's url is the thread's
}

export type ThreadAnchor =
    | { kind: "line"; path: string; line: number; startLine?: number; side: DiffSide }
    | { kind: "file"; path: string };

export interface NewThread {
    anchor: ThreadAnchor;
    body: string;
}

export interface PostedReview {
    id: string;
    url: string;
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
    threads(number: number): Promise<Result<ReviewThread[]>>; // every review thread, any author
    pendingReview(number: number): Promise<Result<string | null>>; // the url of this account's pending review
    // One review with the event COMMENT: a pending review, one thread per entry, then submitted.
    review(
        number: number,
        body: string,
        threads: readonly NewThread[],
    ): Promise<Result<PostedReview>>;
    reply(thread: string, body: string): Promise<Result<void>>;
    resolve(thread: string): Promise<Result<void>>;
    unresolve(thread: string): Promise<Result<void>>;
}

export type PullRequestsFactory = (directory: string) => PullRequests;
