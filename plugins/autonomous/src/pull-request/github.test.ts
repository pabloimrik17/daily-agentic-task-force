import { expect, it, vi } from "vitest";
import type { Exec, ExecResult } from "../exec.ts";
import { threadMarker } from "../publish/markers.ts";
import type { Result } from "../result.ts";
import { gitHubPullRequests, hookedTimeoutMs } from "./github.ts";
import comments from "./fixtures/pr-view-comments.json";
import emptyList from "./fixtures/pr-list-empty.json";
import list from "./fixtures/pr-list.json";
import repoView from "./fixtures/repo-view.json";
import reviewThreads from "./fixtures/review-threads.json";

const DIR = "/work/tree";

// Three fakes, so a test can tell which exec ran a command.
function setup(stdout = "") {
    const reply = () => vi.fn<Exec>().mockResolvedValue({ ok: true, stdout });
    const execs = { gh: reply(), git: reply(), hooked: reply() };
    return { execs, port: gitHubPullRequests(execs, DIR) };
}

function failing(error: string) {
    const exec = vi.fn<Exec>().mockResolvedValue({ ok: false, error });
    return gitHubPullRequests({ gh: exec, git: exec, hooked: exec }, DIR);
}

function errorOf(result: Result<unknown>): string {
    if (result.ok) throw new Error("expected an error");
    return result.error;
}

const [FIRST, SECOND] = list.map(({ number, url, title }) => ({ number, url, title }));

const OPEN = { base: "main", branch: "feature/x", title: "T", bodyFile: "/b.md" };

it("reads the default branch from gh repo view", async () => {
    const { execs, port } = setup(JSON.stringify(repoView));
    expect(await port.defaultBranch()).toEqual({ ok: true, value: "main" });
    expect(execs.gh).toHaveBeenCalledWith(["repo", "view", "--json", "defaultBranchRef"]);
});

it("finds the first open pull request of a branch", async () => {
    const { execs, port } = setup(JSON.stringify(list));
    expect(await port.find("feature/x")).toEqual({ ok: true, value: FIRST });
    expect(execs.gh).toHaveBeenCalledWith([
        "pr",
        "list",
        "--head",
        "feature/x",
        "--state",
        "open",
        "--json",
        "number,url,title,isCrossRepository",
    ]);
});

it("skips a pull request whose head is in a fork", async () => {
    const fork = { ...list[0], number: 99, isCrossRepository: true };
    const { port } = setup(JSON.stringify([fork, list[1]]));
    expect(await port.find("feature/x")).toEqual({ ok: true, value: SECOND });
});

it("finds no pull request when every one listed is from a fork", async () => {
    const { port } = setup(JSON.stringify([{ ...list[0], isCrossRepository: true }]));
    expect(await port.find("feature/x")).toEqual({ ok: true, value: null });
});

it("finds no pull request when the list is empty", async () => {
    const { port } = setup(JSON.stringify(emptyList));
    expect(await port.find("feature/x")).toEqual({ ok: true, value: null });
});

it("counts the commits ahead after fetching the base", async () => {
    const { execs, port } = setup("3\n");
    expect(await port.ahead("main")).toEqual({ ok: true, value: 3 });
    expect(execs.git).toHaveBeenNthCalledWith(1, ["-C", DIR, "fetch", "origin", "main"]);
    expect(execs.git).toHaveBeenNthCalledWith(2, [
        "-C",
        DIR,
        "rev-list",
        "--count",
        "origin/main..HEAD",
    ]);
});

it("does not count when the fetch fails", async () => {
    const result = await failing("git failed: no network").ahead("main");
    expect(result).toEqual({ ok: false, error: "git fetch origin main: git failed: no network" });
});

it("lists the short ids of the commits since a time", async () => {
    const { execs, port } = setup("abc1234 feat: one\ndef5678 fix: two words\n\n");
    expect(await port.commitsSince("main", "2026-01-01T00:00:00Z")).toEqual({
        ok: true,
        value: ["abc1234", "def5678"],
    });
    expect(execs.git).toHaveBeenCalledWith([
        "-C",
        DIR,
        "log",
        "--since=2026-01-01T00:00:00Z",
        "--format=%h %s",
        "origin/main..HEAD",
    ]);
});

it("leaves out the empty commit pull-request mode adds", async () => {
    const { port } = setup(
        "abc1234 feat: one\n9f8e7d6 chore: open the pull request of DOT-121\ndef5678 chore: open the pull request\n",
    );
    expect(await port.commitsSince("main", "2026-01-01T00:00:00Z")).toEqual({
        ok: true,
        value: ["abc1234", "def5678"],
    });
});

it("returns no commits for empty output", async () => {
    const { port } = setup("");
    expect(await port.commitsSince("main", "2026-01-01T00:00:00Z")).toEqual({
        ok: true,
        value: [],
    });
});

it("runs the empty commit and the push on the hooked exec, never skipping hooks or forcing", async () => {
    const { execs, port } = setup();
    expect(await port.emptyCommit("chore: start")).toEqual({ ok: true, value: undefined });
    expect(await port.push("feature/x")).toEqual({ ok: true, value: undefined });
    expect(execs.hooked).toHaveBeenNthCalledWith(1, [
        "-C",
        DIR,
        "commit",
        "--only",
        "--allow-empty",
        "-m",
        "chore: start",
    ]);
    expect(execs.hooked).toHaveBeenNthCalledWith(2, [
        "-C",
        DIR,
        "push",
        "-u",
        "origin",
        "feature/x",
    ]);
    expect(execs.git).not.toHaveBeenCalled();
    expect(execs.gh).not.toHaveBeenCalled();
});

it("opens a draft pull request and takes its number from the URL", async () => {
    const url = "https://github.com/demo/repo/pull/42";
    const { execs, port } = setup(`${url}\n`);
    expect(await port.open(OPEN)).toEqual({ ok: true, value: { number: 42, url, title: "T" } });
    expect(execs.gh).toHaveBeenCalledWith([
        "pr",
        "create",
        "--draft",
        "--base",
        "main",
        "--head",
        "feature/x",
        "--title",
        "T",
        "--body-file",
        "/b.md",
    ]);
});

it("reports a create output without a pull request URL", async () => {
    const { port } = setup("done\n");
    expect(errorOf(await port.open(OPEN))).toContain(
        "gh pr create --head feature/x: unparseable output",
    );
});

it("edits the body, and the title only when given", async () => {
    const { execs, port } = setup();
    await port.edit(7, { bodyFile: "/b.md" });
    await port.edit(7, { title: "New", bodyFile: "/b.md" });
    expect(execs.gh).toHaveBeenNthCalledWith(1, ["pr", "edit", "7", "--body-file", "/b.md"]);
    expect(execs.gh).toHaveBeenNthCalledWith(2, [
        "pr",
        "edit",
        "7",
        "--title",
        "New",
        "--body-file",
        "/b.md",
    ]);
});

it("comments from a file", async () => {
    const { execs, port } = setup();
    expect(await port.comment(7, "/c.md")).toEqual({ ok: true, value: undefined });
    expect(execs.gh).toHaveBeenCalledWith(["pr", "comment", "7", "--body-file", "/c.md"]);
});

it("reads the comment bodies in order", async () => {
    const { execs, port } = setup(JSON.stringify(comments));
    expect(await port.comments(7)).toEqual({
        ok: true,
        value: comments.comments.map((comment) => comment.body),
    });
    expect(execs.gh).toHaveBeenCalledWith(["pr", "view", "7", "--json", "comments"]);
});

it("names the failed command in every error", async () => {
    const port = failing("gh failed: boom");
    expect(await port.find("feature/x")).toEqual({
        ok: false,
        error: "gh pr list --head feature/x: gh failed: boom",
    });
    expect(await port.defaultBranch()).toEqual({
        ok: false,
        error: "gh repo view: gh failed: boom",
    });
    expect(await port.comments(7)).toEqual({ ok: false, error: "gh pr view 7: gh failed: boom" });
    expect(await port.push("feature/x")).toEqual({
        ok: false,
        error: "git push -u origin feature/x: gh failed: boom",
    });
});

it("names the command when its output is not what was expected", async () => {
    const { port } = setup("not json");
    expect(errorOf(await port.find("feature/x"))).toContain(
        "gh pr list --head feature/x: unparseable output",
    );
    expect(errorOf(await port.defaultBranch())).toContain("gh repo view: unparseable output");
    const noName = setup(JSON.stringify({ defaultBranchRef: {} }));
    expect(errorOf(await noName.port.defaultBranch())).toContain(
        "defaultBranchRef.name must be a string",
    );
    const noCount = setup("many");
    expect(errorOf(await noCount.port.ahead("main"))).toContain(
        "git rev-list --count origin/main..HEAD: unparseable",
    );
});

it("gives a hooked command what is left of the budget, in whole seconds", () => {
    expect(hookedTimeoutMs(540_000, 0)).toBe(540_000);
    expect(hookedTimeoutMs(540_000, 300_400)).toBe(239_000);
});

it("never gives a hooked command a timeout of 0, which would mean none", () => {
    expect(hookedTimeoutMs(540_000, 539_900)).toBe(1_000);
    expect(hookedTimeoutMs(540_000, 700_000)).toBe(1_000);
});

// Review threads, through `gh api graphql` (design D8 of add-code-review-stage).

function scripted(...replies: ExecResult[]) {
    const gh = vi.fn<Exec>();
    for (const reply of replies) {
        gh.mockResolvedValueOnce(reply);
    }
    const unused = vi.fn<Exec>();
    return { gh, port: gitHubPullRequests({ gh, git: unused, hooked: unused }, DIR) };
}

function data(value: unknown): ExecResult {
    return { ok: true, stdout: JSON.stringify({ data: value }) };
}

function graphqlCall(gh: ReturnType<typeof vi.fn<Exec>>, index: number) {
    const [args] = gh.mock.calls[index] ?? [[]];
    const [api, endpoint, flag, query = "", ...variables] = args;
    expect([api, endpoint, flag]).toEqual(["api", "graphql", "-f"]);
    return { query: query.replace(/^query=/u, ""), variables };
}

const PR_42 = ["-F", "owner={owner}", "-F", "name={repo}", "-F", "number=42"];

const [MULTI_LINE, FILE_LEVEL, BOT] = reviewThreads.data.repository.pullRequest.reviewThreads.nodes;

function threadPage(nodes: unknown[], next: string | null) {
    const pageInfo = { hasNextPage: next !== null, endCursor: next };
    return data({ repository: { pullRequest: { reviewThreads: { pageInfo, nodes } } } });
}

function withComments(thread: object | undefined, nodes: unknown[], next: string | null) {
    return {
        ...thread,
        comments: { pageInfo: { hasNextPage: next !== null, endCursor: next }, nodes },
    };
}

it("lists the review threads with their comments, markers intact", async () => {
    const { gh, port } = scripted({ ok: true, stdout: JSON.stringify(reviewThreads) });
    const result = await port.threads(42);
    if (!result.ok) throw new Error(result.error);
    const [first, second, third] = result.value;
    expect(first).toEqual({
        id: "PRRT_kwDOUNYMKc66_aaaa",
        path: "src/retry.ts",
        subjectType: "LINE",
        line: 42,
        startLine: 40,
        side: "RIGHT",
        resolved: true,
        outdated: false,
        comments: MULTI_LINE?.comments.nodes.map((comment) => ({
            id: comment.id,
            body: comment.body,
            url: comment.url,
            author: "demo-user",
            createdAt: comment.createdAt,
        })),
    });
    expect(threadMarker(first?.comments[0]?.body ?? "")).toEqual({
        kind: "finding",
        attempt: "linear:DOT-121:code-review:1",
        finding: "f3",
    });
    expect(second).toMatchObject({ path: FILE_LEVEL?.path, subjectType: "FILE", line: null });
    expect(threadMarker(second?.comments[0]?.body ?? "")).toMatchObject({ for: "qa" });
    // A single-line thread's start line equal to its line reads as null; a deleted author as "".
    expect(third).toMatchObject({ line: 7, startLine: null, side: "LEFT", outdated: true });
    expect(third?.comments[0]).toMatchObject({ body: "true", author: "" });
    const call = graphqlCall(gh, 0);
    expect(call.variables).toEqual(PR_42);
    expect(call.query).toMatchInlineSnapshot(`
      "query ReviewThreads($owner: String!, $name: String!, $number: Int!, $after: String) {
        repository(owner: $owner, name: $name) { pullRequest(number: $number) { reviewThreads(first: 100, after: $after) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id path subjectType line startLine diffSide isResolved isOutdated
            comments(first: 100) { pageInfo { hasNextPage endCursor } nodes { id body url author { login } createdAt } }
          }
        } } }
      }"
    `);
});

it("follows the pages of threads and of a thread's comments", async () => {
    const [firstComment, secondComment] = MULTI_LINE?.comments.nodes ?? [];
    const { gh, port } = scripted(
        threadPage([withComments(BOT, [firstComment], "C1")], "T1"),
        threadPage([FILE_LEVEL], null),
        data({
            node: {
                comments: {
                    pageInfo: { hasNextPage: false, endCursor: null },
                    nodes: [secondComment],
                },
            },
        }),
    );
    const result = await port.threads(42);
    if (!result.ok) throw new Error(result.error);
    expect(result.value.map((thread) => thread.id)).toEqual([BOT?.id, FILE_LEVEL?.id]);
    expect(result.value[0]?.comments.map((comment) => comment.id)).toEqual([
        firstComment?.id,
        secondComment?.id,
    ]);
    expect(graphqlCall(gh, 1).variables).toEqual([...PR_42, "-f", "after=T1"]);
    const comments = graphqlCall(gh, 2);
    expect(comments.variables).toEqual(["-f", `thread=${BOT?.id}`, "-f", "after=C1"]);
    expect(comments.query).toMatchInlineSnapshot(`
      "query ThreadComments($thread: ID!, $after: String) {
        node(id: $thread) {
          ... on PullRequestReviewThread { comments(first: 100, after: $after) { pageInfo { hasNextPage endCursor } nodes { id body url author { login } createdAt } } }
        }
      }"
    `);
});

it("names the listing in an unparseable thread", async () => {
    const { port } = scripted(threadPage([{ ...BOT, subjectType: "RANGE" }], null));
    expect(errorOf(await port.threads(42))).toContain(
        "gh api graphql reviewThreads 42: unparseable output: output.data.repository.pullRequest.reviewThreads.nodes[0].subjectType must be one of LINE, FILE",
    );
});

it("reads the url of this account's pending review, or null", async () => {
    const url = "https://github.com/demo/repo/pull/42#pullrequestreview-9";
    const reviews = (nodes: unknown[]) =>
        data({ repository: { pullRequest: { reviews: { nodes } } } });
    const { gh, port } = scripted(reviews([{ url }]), reviews([]));
    expect(await port.pendingReview(42)).toEqual({ ok: true, value: url });
    expect(await port.pendingReview(42)).toEqual({ ok: true, value: null });
    const call = graphqlCall(gh, 0);
    expect(call.variables).toEqual(PR_42);
    expect(call.query).toMatchInlineSnapshot(`
      "query PendingReview($owner: String!, $name: String!, $number: Int!) {
        repository(owner: $owner, name: $name) { pullRequest(number: $number) { reviews(states: PENDING, first: 1) { nodes { url } } } }
      }"
    `);
});

const POSTED = { id: "PRR_1", url: "https://github.com/demo/repo/pull/42#pullrequestreview-1" };

const NEW_THREADS = [
    {
        anchor: { kind: "line", path: "src/a.ts", line: 12, startLine: 10, side: "RIGHT" },
        body: "multi",
    },
    { anchor: { kind: "line", path: "src/a.ts", line: 3, side: "LEFT" }, body: "12" },
    { anchor: { kind: "file", path: "proposal.md" }, body: "file" },
] as const;

function pendingReviewReplies(): ExecResult[] {
    return [
        data({ repository: { pullRequest: { id: "PR_node" } } }),
        data({ addPullRequestReview: { pullRequestReview: { id: "PRR_1" } } }),
    ];
}

const THREAD_ADDED = data({ addPullRequestReviewThread: { thread: { id: "PRRT_new" } } });

it("posts one review: a pending review, one thread per entry, then submitted as COMMENT", async () => {
    const { gh, port } = scripted(
        ...pendingReviewReplies(),
        THREAD_ADDED,
        THREAD_ADDED,
        THREAD_ADDED,
        data({ submitPullRequestReview: { pullRequestReview: POSTED } }),
    );
    expect(await port.review(42, "true", NEW_THREADS)).toEqual({ ok: true, value: POSTED });
    expect(gh).toHaveBeenCalledTimes(6);
    const pullRequest = graphqlCall(gh, 0);
    expect(pullRequest.variables).toEqual(PR_42);
    expect(pullRequest.query).toMatchInlineSnapshot(`
      "query PullRequestId($owner: String!, $name: String!, $number: Int!) {
        repository(owner: $owner, name: $name) { pullRequest(number: $number) { id } }
      }"
    `);
    const pending = graphqlCall(gh, 1);
    expect(pending.variables).toEqual(["-f", "pullRequest=PR_node"]);
    expect(pending.query).toMatchInlineSnapshot(`
      "mutation AddPullRequestReview($pullRequest: ID!) {
        addPullRequestReview(input: { pullRequestId: $pullRequest }) { pullRequestReview { id } }
      }"
    `);
    const multi = graphqlCall(gh, 2);
    expect(multi.variables).toEqual([
        ...["-f", "review=PRR_1", "-f", "path=src/a.ts", "-f", "body=multi"],
        ...["-f", "subjectType=LINE", "-F", "line=12", "-f", "side=RIGHT"],
        ...["-F", "startLine=10", "-f", "startSide=RIGHT"],
    ]);
    expect(multi.query).toMatchInlineSnapshot(`
      "mutation AddPullRequestReviewThread(
        $review: ID!, $path: String!, $body: String!, $subjectType: PullRequestReviewThreadSubjectType!,
        $line: Int, $side: DiffSide, $startLine: Int, $startSide: DiffSide
      ) {
        addPullRequestReviewThread(input: {
          pullRequestReviewId: $review, path: $path, body: $body, subjectType: $subjectType,
          line: $line, side: $side, startLine: $startLine, startSide: $startSide
        }) { thread { id } }
      }"
    `);
    expect(graphqlCall(gh, 3).variables).toEqual([
        ...["-f", "review=PRR_1", "-f", "path=src/a.ts", "-f", "body=12"],
        ...["-f", "subjectType=LINE", "-F", "line=3", "-f", "side=LEFT"],
    ]);
    expect(graphqlCall(gh, 4).variables).toEqual([
        ...["-f", "review=PRR_1", "-f", "path=proposal.md", "-f", "body=file"],
        ...["-f", "subjectType=FILE"],
    ]);
    const submit = graphqlCall(gh, 5);
    expect(submit.variables).toEqual(["-f", "review=PRR_1", "-f", "body=true"]);
    expect(submit.query).toMatchInlineSnapshot(`
      "mutation SubmitPullRequestReview($review: ID!, $body: String!) {
        submitPullRequestReview(input: { pullRequestReviewId: $review, event: COMMENT, body: $body }) { pullRequestReview { id url } }
      }"
    `);
});

it("deletes the pending review when a thread fails, and submits nothing", async () => {
    const { gh, port } = scripted(
        ...pendingReviewReplies(),
        THREAD_ADDED,
        { ok: false, error: "gh failed: gh: line must be part of the diff" },
        data({ deletePullRequestReview: { pullRequestReview: { id: "PRR_1" } } }),
    );
    expect(await port.review(42, "body", NEW_THREADS)).toEqual({
        ok: false,
        error: "gh api graphql addPullRequestReviewThread src/a.ts:3: gh failed: gh: line must be part of the diff; the pending review PRR_1 was deleted",
    });
    expect(gh).toHaveBeenCalledTimes(5);
    const deletion = graphqlCall(gh, 4);
    expect(deletion.variables).toEqual(["-f", "review=PRR_1"]);
    expect(deletion.query).toMatchInlineSnapshot(`
      "mutation DeletePullRequestReview($review: ID!) {
        deletePullRequestReview(input: { pullRequestReviewId: $review }) { pullRequestReview { id } }
      }"
    `);
});

it("reports a failed submit together with a failed deletion", async () => {
    const { port } = scripted(...pendingReviewReplies(), data({ submitPullRequestReview: null }), {
        ok: false,
        error: "gh failed: gh: timeout",
    });
    expect(await port.review(42, "body", [])).toEqual({
        ok: false,
        error: "gh api graphql submitPullRequestReview PRR_1: unparseable output: output.data.submitPullRequestReview must be an object; gh api graphql deletePullRequestReview PRR_1: gh failed: gh: timeout",
    });
});

it("replies in, resolves and unresolves a thread", async () => {
    const { gh, port } = scripted(
        data({ addPullRequestReviewThreadReply: { comment: { id: "PRRC_1" } } }),
        data({ resolveReviewThread: { thread: { id: "PRRT_1" } } }),
        data({ unresolveReviewThread: { thread: { id: "PRRT_1" } } }),
    );
    expect(await port.reply("PRRT_1", "false")).toEqual({ ok: true, value: undefined });
    expect(await port.resolve("PRRT_1")).toEqual({ ok: true, value: undefined });
    expect(await port.unresolve("PRRT_1")).toEqual({ ok: true, value: undefined });
    const reply = graphqlCall(gh, 0);
    expect(reply.variables).toEqual(["-f", "thread=PRRT_1", "-f", "body=false"]);
    expect(reply.query).toMatchInlineSnapshot(`
      "mutation AddPullRequestReviewThreadReply($thread: ID!, $body: String!) {
        addPullRequestReviewThreadReply(input: { pullRequestReviewThreadId: $thread, body: $body }) { comment { id } }
      }"
    `);
    const resolve = graphqlCall(gh, 1);
    expect(resolve.variables).toEqual(["-f", "thread=PRRT_1"]);
    expect(resolve.query).toMatchInlineSnapshot(`
      "mutation ResolveReviewThread($thread: ID!) {
        resolveReviewThread(input: { threadId: $thread }) { thread { id } }
      }"
    `);
    const unresolve = graphqlCall(gh, 2);
    expect(unresolve.variables).toEqual(["-f", "thread=PRRT_1"]);
    expect(unresolve.query).toMatchInlineSnapshot(`
      "mutation UnresolveReviewThread($thread: ID!) {
        unresolveReviewThread(input: { threadId: $thread }) { thread { id } }
      }"
    `);
});

it("reports a GraphQL error in a 200 response with the call's label", async () => {
    const { port } = scripted({
        ok: true,
        stdout: JSON.stringify({
            data: { resolveReviewThread: null },
            errors: [{ type: "NOT_FOUND", message: "Could not resolve to a node" }, { type: "X" }],
        }),
    });
    expect(await port.resolve("PRRT_gone")).toEqual({
        ok: false,
        error: 'gh api graphql resolveReviewThread PRRT_gone: Could not resolve to a node; {"type":"X"}',
    });
});

it("names the failed review-thread call in every error", async () => {
    const port = failing("gh failed: boom");
    expect(errorOf(await port.threads(42))).toBe(
        "gh api graphql reviewThreads 42: gh failed: boom",
    );
    expect(errorOf(await port.pendingReview(42))).toBe(
        "gh api graphql pendingReview 42: gh failed: boom",
    );
    expect(errorOf(await port.review(42, "b", NEW_THREADS))).toBe(
        "gh api graphql pullRequest 42: gh failed: boom",
    );
    expect(errorOf(await port.reply("T", "b"))).toBe(
        "gh api graphql addPullRequestReviewThreadReply T: gh failed: boom",
    );
    expect(errorOf(await port.resolve("T"))).toBe(
        "gh api graphql resolveReviewThread T: gh failed: boom",
    );
    expect(errorOf(await port.unresolve("T"))).toBe(
        "gh api graphql unresolveReviewThread T: gh failed: boom",
    );
});

it("deletes nothing when the pending review cannot be created", async () => {
    const { gh, port } = scripted(pendingReviewReplies()[0]!, {
        ok: false,
        error: "gh failed: gh: one pending review",
    });
    expect(errorOf(await port.review(42, "b", NEW_THREADS))).toBe(
        "gh api graphql addPullRequestReview 42: gh failed: gh: one pending review",
    );
    expect(gh).toHaveBeenCalledTimes(2);
});
