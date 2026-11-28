// `gh` reads its repository from its working directory, so its exec is made with `cwd: directory`;
// every `git` command names the directory with `-C`.

import { CLI_TIMEOUT_MS, type Exec, execCommand } from "../exec.ts";
import type { Result } from "../result.ts";
import {
    type Json,
    ParseError,
    array,
    boolean,
    choice,
    number,
    object,
    string,
} from "../validate.ts";
import {
    type CheckRun,
    type DiffSide,
    EMPTY_COMMIT_SUBJECT,
    type NewThread,
    type PostedReview,
    type PullRequest,
    type PullRequests,
    type PullRequestsFactory,
    type PullRequestState,
    type Review,
    type ReviewThread,
    type ThreadAnchor,
    type ThreadComment,
} from "./port.ts";

// The commit and the push run the repository's hooks, and a pre-push hook can run a whole test
// suite. They share one budget, counted from the start of the process so that it also covers the
// tracker reads made before the port, and kept under the 600 s the run command gives the
// process. A slow hook is then reported by name instead of the process being killed.
const HOOKED_BUDGET_MS = 540_000;

// execFile reads a timeout of 0 as no timeout, so a spent budget still leaves one second.
const HOOKED_FLOOR_MS = 1_000;

/** What a hooked command starting at `now` may take, in whole seconds, before `deadline`. */
export function hookedTimeoutMs(deadline: number, now: number): number {
    return Math.max(Math.floor((deadline - now) / 1_000) * 1_000, HOOKED_FLOOR_MS);
}

function hookedGit(): Exec {
    const deadline = performance.timeOrigin + HOOKED_BUDGET_MS;
    return (args, input) => execCommand("git", hookedTimeoutMs(deadline, Date.now()))(args, input);
}

interface GitHubExecs {
    gh: Exec;
    git: Exec;
    hooked: Exec;
}

async function run(exec: Exec, label: string, args: string[]): Promise<Result<string>> {
    const result = await exec(args);
    return result.ok
        ? { ok: true, value: result.stdout }
        : { ok: false, error: `${label}: ${result.error}` };
}

async function runVoid(exec: Exec, label: string, args: string[]): Promise<Result<void>> {
    const result = await run(exec, label, args);
    return result.ok ? { ok: true, value: undefined } : result;
}

function parseJson<T>(label: string, stdout: string, read: (json: unknown) => T): Result<T> {
    try {
        return { ok: true, value: read(JSON.parse(stdout)) };
    } catch (error) {
        const reason = error instanceof ParseError ? error.message : (error as Error).message;
        return { ok: false, error: `${label}: unparseable output: ${reason}` };
    }
}

function readPullRequest(value: unknown, path: string): PullRequest {
    const json = object(value, path);
    return {
        number: number(json, "number", path),
        url: string(json, "url", path),
        title: string(json, "title", path),
    };
}

function readDefaultBranch(json: unknown): string {
    const ref = object(object(json, "output").defaultBranchRef, "output.defaultBranchRef");
    return string(ref, "name", "output.defaultBranchRef");
}

// `--head` matches the branch name alone, so a pull request from a fork with the same branch name
// is skipped.
function readFirstPullRequest(json: unknown): PullRequest | null {
    const list = array(json, "output");
    const own = list.findIndex((item, index) => {
        const path = `output[${index}]`;
        return !boolean(object(item, path), "isCrossRepository", path);
    });
    return own === -1 ? null : readPullRequest(list[own], `output[${own}]`);
}

function readCommentBodies(json: unknown): string[] {
    const comments = array(object(json, "output").comments, "output.comments");
    return comments.map((comment, index) => {
        const path = `output.comments[${index}]`;
        return string(object(comment, path), "body", path);
    });
}

// `gh pr create` prints the new pull request's URL, `…/pull/<n>`, as its last line.
function parseCreated(label: string, stdout: string, title: string): Result<PullRequest> {
    const url = stdout.trim().split("\n").at(-1)?.trim() ?? "";
    const match = /\/pull\/(\d+)$/.exec(url);
    if (match === null) {
        const shown = JSON.stringify(stdout.trim());
        return {
            ok: false,
            error: `${label}: unparseable output: no pull request URL in ${shown}`,
        };
    }
    return { ok: true, value: { number: Number(match[1]), url, title } };
}

function parseCount(label: string, stdout: string): Result<number> {
    const text = stdout.trim();
    return /^\d+$/.test(text)
        ? { ok: true, value: Number(text) }
        : {
              ok: false,
              error: `${label}: unparseable output: ${JSON.stringify(text)} is not a count`,
          };
}

function parseLines(stdout: string): string[] {
    return stdout
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line !== "");
}

function shortIds(stdout: string): string[] {
    return parseLines(stdout)
        .filter((line) => !line.slice(line.indexOf(" ") + 1).startsWith(EMPTY_COMMIT_SUBJECT))
        .flatMap((line) => line.split(" ", 1));
}

// Review threads exist only in GitHub's GraphQL API (design D8 of add-code-review-stage). Strings go
// with `-f`, so a body such as "true" or "12" stays a string; `-F` types the numbers and fills
// gh's `{owner}` and `{repo}` placeholders from the working directory's repository.

const PULL_REQUEST_VARIABLES = "$owner: String!, $name: String!, $number: Int!";

function onPullRequest(selection: string): string {
    return `repository(owner: $owner, name: $name) { pullRequest(number: $number) { ${selection} } }`;
}

const COMMENTS_FIELDS =
    "pageInfo { hasNextPage endCursor } nodes { id body url author { login } createdAt }";

const THREADS_QUERY = `query ReviewThreads(${PULL_REQUEST_VARIABLES}, $after: String) {
  ${onPullRequest(`reviewThreads(first: 100, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id path subjectType line startLine diffSide isResolved isOutdated
      comments(first: 100) { ${COMMENTS_FIELDS} }
    }
  }`)}
}`;

const COMMENTS_QUERY = `query ThreadComments($thread: ID!, $after: String) {
  node(id: $thread) {
    ... on PullRequestReviewThread { comments(first: 100, after: $after) { ${COMMENTS_FIELDS} } }
  }
}`;

// GitHub shows a pending review only to its author.
const PENDING_REVIEW_QUERY = `query PendingReview(${PULL_REQUEST_VARIABLES}) {
  ${onPullRequest("reviews(states: PENDING, first: 1) { nodes { url } }")}
}`;

const PULL_REQUEST_ID_QUERY = `query PullRequestId(${PULL_REQUEST_VARIABLES}) {
  ${onPullRequest("id")}
}`;

// No event: the review stays pending until it is submitted.
const ADD_REVIEW_MUTATION = `mutation AddPullRequestReview($pullRequest: ID!) {
  addPullRequestReview(input: { pullRequestId: $pullRequest }) { pullRequestReview { id } }
}`;

// A variable left out leaves its input field unset.
const ADD_THREAD_MUTATION = `mutation AddPullRequestReviewThread(
  $review: ID!, $path: String!, $body: String!, $subjectType: PullRequestReviewThreadSubjectType!,
  $line: Int, $side: DiffSide, $startLine: Int, $startSide: DiffSide
) {
  addPullRequestReviewThread(input: {
    pullRequestReviewId: $review, path: $path, body: $body, subjectType: $subjectType,
    line: $line, side: $side, startLine: $startLine, startSide: $startSide
  }) { thread { id } }
}`;

// The event is fixed: a run never approves or requests changes.
const SUBMIT_REVIEW_MUTATION = `mutation SubmitPullRequestReview($review: ID!, $body: String!) {
  submitPullRequestReview(input: { pullRequestReviewId: $review, event: COMMENT, body: $body }) { pullRequestReview { id url } }
}`;

const DELETE_REVIEW_MUTATION = `mutation DeletePullRequestReview($review: ID!) {
  deletePullRequestReview(input: { pullRequestReviewId: $review }) { pullRequestReview { id } }
}`;

const REPLY_MUTATION = `mutation AddPullRequestReviewThreadReply($thread: ID!, $body: String!) {
  addPullRequestReviewThreadReply(input: { pullRequestReviewThreadId: $thread, body: $body }) { comment { id } }
}`;

const RESOLVE_MUTATION = `mutation ResolveReviewThread($thread: ID!) {
  resolveReviewThread(input: { threadId: $thread }) { thread { id } }
}`;

const UNRESOLVE_MUTATION = `mutation UnresolveReviewThread($thread: ID!) {
  unresolveReviewThread(input: { threadId: $thread }) { thread { id } }
}`;

function text(name: string, value: string): string[] {
    return ["-f", `${name}=${value}`];
}

function typed(name: string, value: number | string): string[] {
    return ["-F", `${name}=${value}`];
}

function pullRequestVariables(pullNumber: number): string[] {
    return [
        ...typed("owner", "{owner}"),
        ...typed("name", "{repo}"),
        ...typed("number", pullNumber),
    ];
}

function cursor(after: string | null): string[] {
    return after === null ? [] : text("after", after);
}

function graphQlErrors(response: Json): string | null {
    const errors = response.errors;
    if (!Array.isArray(errors) || errors.length === 0) {
        return null;
    }
    return errors
        .map((error: unknown) => {
            const message = (error as { message?: unknown } | null)?.message;
            return typeof message === "string" ? message : JSON.stringify(error);
        })
        .join("; ");
}

// gh exits non-zero when a response holds `errors`; they are read here too, so that a 200 response
// holding them is never taken for data.
async function graphql<T>(
    gh: Exec,
    label: string,
    query: string,
    variables: string[],
    read: (data: Json) => T,
): Promise<Result<T>> {
    const out = await run(gh, label, ["api", "graphql", "-f", `query=${query}`, ...variables]);
    if (!out.ok) {
        return out;
    }
    const parsed = parseJson(label, out.value, (json): Result<T> => {
        const response = object(json, "output");
        const errors = graphQlErrors(response);
        return errors === null
            ? { ok: true, value: read(object(response.data, "output.data")) }
            : { ok: false, error: `${label}: ${errors}` };
    });
    return parsed.ok ? parsed.value : parsed;
}

function ignoreData(): void {}

function nullableNumber(parent: Json, key: string, path: string): number | null {
    return parent[key] === null ? null : number(parent, key, path);
}

function nullableString(parent: Json, key: string, path: string): string | null {
    return parent[key] === null ? null : string(parent, key, path);
}

function pullRequestOf(data: Json): Json {
    const repository = object(data.repository, "output.data.repository");
    return object(repository.pullRequest, "output.data.repository.pullRequest");
}

function payloadNode(data: Json, mutation: string, node: string): Json {
    const payload = object(data[mutation], `output.data.${mutation}`);
    return object(payload[node], `output.data.${mutation}.${node}`);
}

function payloadId(data: Json, mutation: string, node: string): string {
    return string(payloadNode(data, mutation, node), "id", `output.data.${mutation}.${node}`);
}

interface Page<T> {
    nodes: T[];
    next: string | null;
}

function readPage<T>(
    value: unknown,
    path: string,
    read: (node: unknown, path: string) => T,
): Page<T> {
    const connection = object(value, path);
    const info = object(connection.pageInfo, `${path}.pageInfo`);
    const more = boolean(info, "hasNextPage", `${path}.pageInfo`);
    return {
        nodes: array(connection.nodes, `${path}.nodes`).map((node, index) =>
            read(node, `${path}.nodes[${index}]`),
        ),
        next: more ? string(info, "endCursor", `${path}.pageInfo`) : null,
    };
}

async function collect<T>(
    fetchPage: (after: string | null) => Promise<Result<Page<T>>>,
    first: string | null,
): Promise<Result<T[]>> {
    const all: T[] = [];
    let after = first;
    do {
        const page = await fetchPage(after);
        if (!page.ok) {
            return page;
        }
        all.push(...page.value.nodes);
        after = page.value.next;
    } while (after !== null);
    return { ok: true, value: all };
}

function readComment(value: unknown, path: string): ThreadComment {
    const json = object(value, path);
    const author = json.author === null ? null : object(json.author, `${path}.author`);
    return {
        id: string(json, "id", path),
        body: string(json, "body", path),
        url: string(json, "url", path),
        author: author === null ? "" : string(author, "login", `${path}.author`),
        createdAt: string(json, "createdAt", path),
    };
}

const SUBJECT_TYPES: readonly ReviewThread["subjectType"][] = ["LINE", "FILE"];

const DIFF_SIDES: readonly DiffSide[] = ["LEFT", "RIGHT"];

interface ListedThread {
    thread: ReviewThread;
    moreComments: string | null;
}

// GitHub gives a single-line thread a start line equal to its line; the port keeps it for a
// multi-line thread.
function readThread(value: unknown, path: string): ListedThread {
    const json = object(value, path);
    const line = nullableNumber(json, "line", path);
    const startLine = nullableNumber(json, "startLine", path);
    const comments = readPage(json.comments, `${path}.comments`, readComment);
    return {
        thread: {
            id: string(json, "id", path),
            path: string(json, "path", path),
            subjectType: choice(json, "subjectType", path, SUBJECT_TYPES),
            line,
            startLine: startLine === line ? null : startLine,
            side: json.diffSide === null ? null : choice(json, "diffSide", path, DIFF_SIDES),
            resolved: boolean(json, "isResolved", path),
            outdated: boolean(json, "isOutdated", path),
            comments: comments.nodes,
        },
        moreComments: comments.next,
    };
}

function readThreadPage(data: Json): Page<ListedThread> {
    const path = "output.data.repository.pullRequest.reviewThreads";
    return readPage(pullRequestOf(data).reviewThreads, path, readThread);
}

function readCommentPage(data: Json): Page<ThreadComment> {
    const node = object(data.node, "output.data.node");
    return readPage(node.comments, "output.data.node.comments", readComment);
}

function readPendingReview(data: Json): string | null {
    const path = "output.data.repository.pullRequest.reviews";
    const reviews = object(pullRequestOf(data).reviews, path);
    const [first] = array(reviews.nodes, `${path}.nodes`);
    return first === undefined
        ? null
        : string(object(first, `${path}.nodes[0]`), "url", `${path}.nodes[0]`);
}

async function listThreads(gh: Exec, pullNumber: number): Promise<Result<ReviewThread[]>> {
    const label = `gh api graphql reviewThreads ${pullNumber}`;
    const variables = pullRequestVariables(pullNumber);
    const listed = await collect(
        (after) =>
            graphql(gh, label, THREADS_QUERY, [...variables, ...cursor(after)], readThreadPage),
        null,
    );
    if (!listed.ok) {
        return listed;
    }
    const threads: ReviewThread[] = [];
    for (const { thread, moreComments } of listed.value) {
        const rest = await restOfComments(gh, thread.id, moreComments);
        if (!rest.ok) {
            return rest;
        }
        threads.push({ ...thread, comments: [...thread.comments, ...rest.value] });
    }
    return { ok: true, value: threads };
}

function restOfComments(
    gh: Exec,
    thread: string,
    after: string | null,
): Promise<Result<ThreadComment[]>> {
    if (after === null) {
        return Promise.resolve({ ok: true, value: [] });
    }
    const label = `gh api graphql comments ${thread}`;
    const variables = text("thread", thread);
    return collect(
        (page) =>
            graphql(gh, label, COMMENTS_QUERY, [...variables, ...cursor(page)], readCommentPage),
        after,
    );
}

function anchorVariables(anchor: ThreadAnchor): string[] {
    if (anchor.kind === "file") {
        return text("subjectType", "FILE");
    }
    const { line, startLine, side } = anchor;
    const range =
        startLine === undefined || startLine === line
            ? []
            : [...typed("startLine", startLine), ...text("startSide", side)];
    return [
        ...text("subjectType", "LINE"),
        ...typed("line", line),
        ...text("side", side),
        ...range,
    ];
}

function anchorName(anchor: ThreadAnchor): string {
    return anchor.kind === "file" ? anchor.path : `${anchor.path}:${anchor.line}`;
}

async function addThreads(
    gh: Exec,
    review: string,
    threads: readonly NewThread[],
): Promise<Result<void>> {
    for (const { anchor, body } of threads) {
        const label = `gh api graphql addPullRequestReviewThread ${anchorName(anchor)}`;
        const variables = [
            ...text("review", review),
            ...text("path", anchor.path),
            ...text("body", body),
            ...anchorVariables(anchor),
        ];
        const added = await graphql(gh, label, ADD_THREAD_MUTATION, variables, (data) =>
            payloadId(data, "addPullRequestReviewThread", "thread"),
        );
        if (!added.ok) {
            return added;
        }
    }
    return { ok: true, value: undefined };
}

function submitReview(gh: Exec, review: string, body: string): Promise<Result<PostedReview>> {
    const label = `gh api graphql submitPullRequestReview ${review}`;
    const variables = [...text("review", review), ...text("body", body)];
    return graphql(gh, label, SUBMIT_REVIEW_MUTATION, variables, (data) => {
        const path = "output.data.submitPullRequestReview.pullRequestReview";
        const posted = payloadNode(data, "submitPullRequestReview", "pullRequestReview");
        return { id: string(posted, "id", path), url: string(posted, "url", path) };
    });
}

// A pending review left behind would block the next run's, since an account holds one per
// pull request.
async function discardReview(gh: Exec, review: string, error: string): Promise<Result<never>> {
    const label = `gh api graphql deletePullRequestReview ${review}`;
    const deleted = await graphql(
        gh,
        label,
        DELETE_REVIEW_MUTATION,
        text("review", review),
        ignoreData,
    );
    const outcome = deleted.ok ? `the pending review ${review} was deleted` : deleted.error;
    return { ok: false, error: `${error}; ${outcome}` };
}

async function postReview(
    gh: Exec,
    pullNumber: number,
    body: string,
    threads: readonly NewThread[],
): Promise<Result<PostedReview>> {
    const pullRequest = await graphql(
        gh,
        `gh api graphql pullRequest ${pullNumber}`,
        PULL_REQUEST_ID_QUERY,
        pullRequestVariables(pullNumber),
        (data) => string(pullRequestOf(data), "id", "output.data.repository.pullRequest"),
    );
    if (!pullRequest.ok) {
        return pullRequest;
    }
    const pending = await graphql(
        gh,
        `gh api graphql addPullRequestReview ${pullNumber}`,
        ADD_REVIEW_MUTATION,
        text("pullRequest", pullRequest.value),
        (data) => payloadId(data, "addPullRequestReview", "pullRequestReview"),
    );
    if (!pending.ok) {
        return pending;
    }
    const added = await addThreads(gh, pending.value, threads);
    const posted = added.ok ? await submitReview(gh, pending.value, body) : added;
    return posted.ok ? posted : discardReview(gh, pending.value, posted.error);
}

// What the wait and the quiet round of external review read (design D2 of add-external-review-stage).
// A review's id is its GraphQL node id, which is what `dismissPullRequestReview` takes; the REST
// dismissal wants the numeric id instead, and the two are not interchangeable.

const STATE_QUERY = `query PullRequestState(${PULL_REQUEST_VARIABLES}) {
  ${onPullRequest(`isDraft
    commits(last: 1) { nodes { commit { oid committedDate } } }
    timelineItems(last: 1, itemTypes: [READY_FOR_REVIEW_EVENT]) {
      nodes { ... on ReadyForReviewEvent { createdAt } }
    }`)}
}`;

const REVIEWS_QUERY = `query Reviews(${PULL_REQUEST_VARIABLES}, $after: String) {
  ${onPullRequest(`reviews(first: 100, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes { id author { login } state commit { oid } body url }
  }`)}
}`;

const DISMISS_MUTATION = `mutation DismissPullRequestReview($review: ID!, $message: String!) {
  dismissPullRequestReview(input: { pullRequestReviewId: $review, message: $message }) { pullRequestReview { id } }
}`;

function readState(data: Json): PullRequestState {
    const path = "output.data.repository.pullRequest";
    const pullRequest = pullRequestOf(data);
    const commits = object(pullRequest.commits, `${path}.commits`);
    const [node] = array(commits.nodes, `${path}.commits.nodes`);
    const headPath = `${path}.commits.nodes[0].commit`;
    const head = object(object(node, `${path}.commits.nodes[0]`).commit, headPath);
    const events = object(pullRequest.timelineItems, `${path}.timelineItems`);
    const [ready] = array(events.nodes, `${path}.timelineItems.nodes`);
    const readyPath = `${path}.timelineItems.nodes[0]`;
    return {
        draft: boolean(pullRequest, "isDraft", path),
        head: {
            sha: string(head, "oid", headPath),
            committedAt: string(head, "committedDate", headPath),
        },
        readyAt:
            ready === undefined ? null : string(object(ready, readyPath), "createdAt", readyPath),
    };
}

function readReview(value: unknown, path: string): Review {
    const json = object(value, path);
    const author = json.author === null ? null : object(json.author, `${path}.author`);
    const commit = json.commit === null ? null : object(json.commit, `${path}.commit`);
    return {
        id: string(json, "id", path),
        author: author === null ? "" : string(author, "login", `${path}.author`),
        state: string(json, "state", path),
        commit: commit === null ? null : string(commit, "oid", `${path}.commit`),
        body: string(json, "body", path),
        url: string(json, "url", path),
    };
}

function readReviewPage(data: Json): Page<Review> {
    const path = "output.data.repository.pullRequest.reviews";
    return readPage(pullRequestOf(data).reviews, path, readReview);
}

function listReviews(gh: Exec, pullNumber: number): Promise<Result<Review[]>> {
    const label = `gh api graphql reviews ${pullNumber}`;
    const variables = pullRequestVariables(pullNumber);
    return collect(
        (after) =>
            graphql(gh, label, REVIEWS_QUERY, [...variables, ...cursor(after)], readReviewPage),
        null,
    );
}

// The listing is wrapped in { total_count, check_runs } and held to 100 a page, so a page is
// known to be the last one from the count alone, with no cursor.
const CHECK_RUNS_PER_PAGE = 100;

function readCheckRun(value: unknown, path: string): CheckRun {
    const json = object(value, path);
    const app = json.app === null ? null : object(json.app, `${path}.app`);
    const output = object(json.output, `${path}.output`);
    return {
        name: string(json, "name", path),
        app: app === null ? "" : string(app, "slug", `${path}.app`),
        status: string(json, "status", path),
        conclusion: nullableString(json, "conclusion", path),
        title: nullableString(output, "title", `${path}.output`),
        summary: nullableString(output, "summary", `${path}.output`),
        url: string(json, "html_url", path),
        startedAt: nullableString(json, "started_at", path),
        completedAt: nullableString(json, "completed_at", path),
    };
}

function readCheckRunPage(page: number): (json: unknown) => Page<CheckRun> {
    return (json) => {
        const listing = object(json, "output");
        const total = number(listing, "total_count", "output");
        const runs = array(listing.check_runs, "output.check_runs").map((run, index) =>
            readCheckRun(run, `output.check_runs[${index}]`),
        );
        const more = runs.length > 0 && page * CHECK_RUNS_PER_PAGE < total;
        return { nodes: runs, next: more ? String(page + 1) : null };
    };
}

function listCheckRuns(gh: Exec, sha: string): Promise<Result<CheckRun[]>> {
    const label = `gh api commits/${sha}/check-runs`;
    return collect(async (after) => {
        const page = after === null ? 1 : Number(after);
        const endpoint = `repos/{owner}/{repo}/commits/${sha}/check-runs`;
        const out = await run(gh, label, [
            "api",
            `${endpoint}?per_page=${CHECK_RUNS_PER_PAGE}&page=${page}`,
        ]);
        return out.ok ? parseJson(label, out.value, readCheckRunPage(page)) : out;
    }, null);
}

type ExternalReviewMethods = Pick<
    PullRequests,
    "state" | "ready" | "checkRuns" | "reviews" | "dismiss"
>;

function externalReview(gh: Exec): ExternalReviewMethods {
    return {
        state: (pullNumber) =>
            graphql(
                gh,
                `gh api graphql state ${pullNumber}`,
                STATE_QUERY,
                pullRequestVariables(pullNumber),
                readState,
            ),
        ready: (pullNumber) =>
            runVoid(gh, `gh pr ready ${pullNumber}`, ["pr", "ready", String(pullNumber)]),
        checkRuns: (sha) => listCheckRuns(gh, sha),
        reviews: (pullNumber) => listReviews(gh, pullNumber),
        // The review is named by its node id alone, so the pull request number is not sent.
        dismiss: (_pullNumber, review, message) =>
            graphql(
                gh,
                `gh api graphql dismissPullRequestReview ${review}`,
                DISMISS_MUTATION,
                [...text("review", review), ...text("message", message)],
                ignoreData,
            ),
    };
}

type ReviewThreadMethods = Pick<
    PullRequests,
    "threads" | "pendingReview" | "review" | "reply" | "resolve" | "unresolve"
>;

function reviewThreads(gh: Exec): ReviewThreadMethods {
    const onThread = (mutation: string, query: string, thread: string, body: string[] = []) =>
        graphql(
            gh,
            `gh api graphql ${mutation} ${thread}`,
            query,
            [...text("thread", thread), ...body],
            ignoreData,
        );
    return {
        threads: (pullNumber) => listThreads(gh, pullNumber),
        pendingReview: (pullNumber) =>
            graphql(
                gh,
                `gh api graphql pendingReview ${pullNumber}`,
                PENDING_REVIEW_QUERY,
                pullRequestVariables(pullNumber),
                readPendingReview,
            ),
        review: (pullNumber, body, threads) => postReview(gh, pullNumber, body, threads),
        reply: (thread, body) =>
            onThread("addPullRequestReviewThreadReply", REPLY_MUTATION, thread, text("body", body)),
        resolve: (thread) => onThread("resolveReviewThread", RESOLVE_MUTATION, thread),
        unresolve: (thread) => onThread("unresolveReviewThread", UNRESOLVE_MUTATION, thread),
    };
}

export function gitHubPullRequests(execs: GitHubExecs, directory: string): PullRequests {
    const { gh, git, hooked } = execs;
    const inDirectory = ["-C", directory];

    return {
        async defaultBranch() {
            const label = "gh repo view";
            const out = await run(gh, label, ["repo", "view", "--json", "defaultBranchRef"]);
            return out.ok ? parseJson(label, out.value, readDefaultBranch) : out;
        },
        async find(branch) {
            const label = `gh pr list --head ${branch}`;
            const args = ["pr", "list", "--head", branch, "--state", "open"];
            const out = await run(gh, label, [
                ...args,
                "--json",
                "number,url,title,isCrossRepository",
            ]);
            return out.ok ? parseJson(label, out.value, readFirstPullRequest) : out;
        },
        async ahead(base) {
            const fetchArgs = [...inDirectory, "fetch", "origin", base];
            const fetched = await runVoid(git, `git fetch origin ${base}`, fetchArgs);
            if (!fetched.ok) {
                return fetched;
            }
            const label = `git rev-list --count origin/${base}..HEAD`;
            const args = [...inDirectory, "rev-list", "--count", `origin/${base}..HEAD`];
            const out = await run(git, label, args);
            return out.ok ? parseCount(label, out.value) : out;
        },
        async commitsSince(base, since) {
            const label = `git log --since=${since} origin/${base}..HEAD`;
            const args = [...inDirectory, "log", `--since=${since}`, "--format=%h %s"];
            const out = await run(git, label, [...args, `origin/${base}..HEAD`]);
            return out.ok ? { ok: true, value: shortIds(out.value) } : out;
        },
        emptyCommit(message) {
            // `--only` with no path keeps whatever is staged out of the commit.
            const args = [...inDirectory, "commit", "--only", "--allow-empty", "-m", message];
            return runVoid(hooked, "git commit --allow-empty", args);
        },
        push(branch) {
            const args = [...inDirectory, "push", "-u", "origin", branch];
            return runVoid(hooked, `git push -u origin ${branch}`, args);
        },
        async open({ base, branch, title, bodyFile }) {
            const label = `gh pr create --head ${branch}`;
            const args = ["pr", "create", "--draft", "--base", base, "--head", branch];
            const out = await run(gh, label, [...args, "--title", title, "--body-file", bodyFile]);
            return out.ok ? parseCreated(label, out.value, title) : out;
        },
        edit(pullNumber, change) {
            const title = change.title === undefined ? [] : ["--title", change.title];
            const args = [
                "pr",
                "edit",
                String(pullNumber),
                ...title,
                "--body-file",
                change.bodyFile,
            ];
            return runVoid(gh, `gh pr edit ${pullNumber}`, args);
        },
        comment(pullNumber, file) {
            const args = ["pr", "comment", String(pullNumber), "--body-file", file];
            return runVoid(gh, `gh pr comment ${pullNumber}`, args);
        },
        async comments(pullNumber) {
            const label = `gh pr view ${pullNumber}`;
            const out = await run(gh, label, [
                "pr",
                "view",
                String(pullNumber),
                "--json",
                "comments",
            ]);
            return out.ok ? parseJson(label, out.value, readCommentBodies) : out;
        },
        ...reviewThreads(gh),
        ...externalReview(gh),
    };
}

export const ghPullRequests: PullRequestsFactory = (directory) =>
    gitHubPullRequests(
        {
            gh: execCommand("gh", CLI_TIMEOUT_MS, { cwd: directory }),
            git: execCommand("git"),
            hooked: hookedGit(),
        },
        directory,
    );
