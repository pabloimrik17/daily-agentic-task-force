import { existsSync, readFileSync, rmSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { type AttemptId, attemptId } from "../attempts/record.ts";
import { attemptDir, writeRecord } from "../attempts/state.ts";
import { record as startedAttempt, tempState } from "../attempts/test-fixtures.ts";
import type { Exec, ExecResult } from "../exec.ts";
import { config } from "../label-triage/test-fixtures.ts";
import type { NewThread, PullRequests, ReviewThread, ThreadAnchor } from "../pull-request/port.ts";
import type { Result } from "../result.ts";
import type { StageId } from "../stages/stage.ts";
import { firstComment } from "./format.ts";
import { parseMarkers, threadMarker } from "./markers.ts";
import { publicationOf } from "./outcome.ts";
import { type PublishDeps, runPublish } from "./publish.ts";
import { digestOf, FINDINGS_FILE, PUBLISH_RECEIPT_FILE } from "./receipt.ts";
import type { FindingEntry, RecordEntry } from "./record.ts";
import { PUBLISH_SCHEMA, renderPublishText, type PublishReport } from "./report.ts";
import {
    ATTEMPT,
    CHANGE,
    DIFF,
    finding,
    findingsRecord,
    recordText,
    ROUND_ONE,
} from "./test-fixtures.ts";
import type { PlannotatorAccess, WalkthroughInput, WalkthroughOutcome } from "./walkthrough.ts";

const STARTED = new Date("2026-11-25T10:00:00.000Z");
const SECOND = "linear:DOT-121:code-review:2" as AttemptId;
const PR_URL = "https://github.com/owner/repo/pull/7";
const BRANCH = "feature/DOT-121-fix-the-login";
const WORKTREE = "/w/repo-worktrees/feature-DOT-121-fix-the-login";

const STATES: string[] = [];
afterAll(() => {
    for (const dir of STATES) {
        rmSync(dir, { recursive: true, force: true });
    }
});

type Method = keyof PullRequests;

interface PortOptions {
    threads?: ReviewThread[];
    pending?: string | null;
    failing?: { method: Method; error: string }; // every call of that method fails
    sticky?: boolean; // false: resolve and unresolve succeed but change nothing
}

interface FakePort {
    port: PullRequests;
    calls: string[];
    threads: ReviewThread[];
    reviews: { body: string; threads: readonly NewThread[] }[];
    options: PortOptions;
}

function comment(thread: string, index: number, body: string) {
    return {
        id: `${thread}-c${index}`,
        body,
        url: `${PR_URL}#discussion-${thread}-${index}`,
        author: "me", // the machine's gh account posts the stage's comments and the human's
        createdAt: "2026-11-25T09:00:00Z",
    };
}

function thread(
    id: string,
    bodies: string[],
    overrides: Partial<Omit<ReviewThread, "comments">> = {},
): ReviewThread {
    return {
        id,
        path: "src/retry.ts",
        subjectType: "LINE",
        line: 12,
        startLine: null,
        side: "RIGHT",
        resolved: false,
        outdated: false,
        comments: bodies.map((body, index) => comment(id, index, body)),
        ...overrides,
    };
}

function placed(id: string, anchor: ThreadAnchor, body: string): ReviewThread {
    return anchor.kind === "file"
        ? thread(id, [body], { path: anchor.path, subjectType: "FILE", line: null, side: null })
        : thread(id, [body], {
              path: anchor.path,
              line: anchor.line,
              startLine: anchor.startLine ?? null,
              side: anchor.side,
          });
}

function fakePort(options: PortOptions = {}): FakePort {
    const fake: FakePort = {
        port: {} as PullRequests,
        calls: [],
        threads: structuredClone(options.threads ?? []),
        reviews: [],
        options,
    };
    const call = <T>(method: Method, detail: string, value: () => T): Promise<Result<T>> => {
        fake.calls.push(detail === "" ? method : `${method} ${detail}`);
        const failing = fake.options.failing;
        return Promise.resolve(
            failing?.method === method
                ? { ok: false, error: failing.error }
                : { ok: true, value: value() },
        );
    };
    const find = (id: string) => {
        const found = fake.threads.find((item) => item.id === id);
        if (found === undefined) {
            throw new Error(`no thread ${id}`);
        }
        return found;
    };
    const setResolved = (id: string, resolved: boolean) => {
        if (fake.options.sticky !== false) {
            find(id).resolved = resolved;
        }
    };
    const unexpected = (method: Method) => () => {
        fake.calls.push(method);
        return Promise.resolve({ ok: false as const, error: `${method} was not expected` });
    };
    fake.port = {
        defaultBranch: () => call("defaultBranch", "", () => "main"),
        find: (branch) =>
            call("find", branch, () => ({ number: 7, url: PR_URL, title: "fix: the login" })),
        ahead: unexpected("ahead"),
        commitsSince: unexpected("commitsSince"),
        emptyCommit: unexpected("emptyCommit"),
        push: unexpected("push"),
        open: unexpected("open"),
        edit: unexpected("edit"),
        comment: unexpected("comment"),
        comments: unexpected("comments"),
        threads: () => call("threads", "", () => structuredClone(fake.threads)),
        pendingReview: () => call("pendingReview", "", () => fake.options.pending ?? null),
        review: (_number, body, threads) =>
            call("review", String(threads.length), () => {
                fake.reviews.push({ body, threads });
                for (const { anchor, body: first } of threads) {
                    fake.threads.push(placed(`T${fake.threads.length + 1}`, anchor, first));
                }
                const n = fake.reviews.length;
                return { id: `R${n}`, url: `${PR_URL}#pullrequestreview-${n}` };
            }),
        reply: (id, body) =>
            call("reply", id, () => {
                const target = find(id);
                target.comments.push(comment(id, target.comments.length, body));
            }),
        resolve: (id) => call("resolve", id, () => setResolved(id, true)),
        unresolve: (id) => call("unresolve", id, () => setResolved(id, false)),
    };
    return fake;
}

const fail = (error: string): ExecResult => ({ ok: false, error });

function fakeGit(work: { ahead?: number | undefined; diff?: string | undefined } = {}): Exec {
    const { ahead = 0, diff = DIFF } = work;
    return (args) => {
        const [verb] = args.slice(2);
        const changes = `openspec/changes/${CHANGE}/proposal.md\n`;
        const answers: Record<string, ExecResult> = {
            fetch: { ok: true, stdout: "" },
            "rev-parse": { ok: true, stdout: "0ddba11\n" },
            "rev-list": { ok: true, stdout: `${ahead}\n` },
            log: { ok: true, stdout: "f00dfee\n" },
            "merge-base": { ok: true, stdout: "5ca1ab1e\n" },
            diff: { ok: true, stdout: args.includes("--name-only") ? changes : diff },
        };
        return Promise.resolve(answers[verb ?? ""] ?? fail(`git ${verb} was not expected`));
    };
}

interface Setup {
    id?: AttemptId;
    text?: string | null; // findings.json; null: none
    entries?: readonly RecordEntry[];
    port?: FakePort;
    plannotator?: boolean;
    walkthrough?: WalkthroughOutcome;
    ahead?: number;
    diff?: string;
}

interface Harness {
    deps: PublishDeps;
    dir: string;
    text: string | null;
    fake: FakePort;
    walkthroughs: { input: WalkthroughInput; plannotator: PlannotatorAccess }[];
}

function textOf(id: AttemptId, entries: readonly RecordEntry[]): string {
    return `${JSON.stringify({ ...findingsRecord(entries), attempt: id }, null, 2)}\n`;
}

// A started attempt of linear:DOT-121 whose stage and number come from its id; its directory.
async function writeAttempt(state: string, id: AttemptId): Promise<string> {
    const [, , stage = "", n = ""] = id.split(":");
    const ref = { source: "linear" as const, id: "DOT-121" };
    const record = startedAttempt({
        id: attemptId(ref, stage as StageId, Number(n)),
        task: { ...ref, title: "Fix the login" },
        stage: stage as StageId,
        attempt: Number(n),
        workspace: {
            manager: "worktrunk",
            repository: "/w/repo",
            inferredFrom: "project Repo",
            branch: BRANCH,
            path: WORKTREE,
        },
    });
    await writeRecord(state, record);
    return attemptDir(state, record.id);
}

const plannotatorExec =
    (available: boolean): Exec =>
    (args) =>
        Promise.resolve(
            available
                ? { ok: true, stdout: args[0] === "--version" ? "0.9.0\n" : "" }
                : fail("plannotator CLI not found on PATH"),
        );

async function setup(options: Setup = {}): Promise<Harness> {
    const state = tempState();
    STATES.push(state);
    const id = options.id ?? ATTEMPT;
    const dir = await writeAttempt(state, id);
    const text =
        options.text === undefined ? textOf(id, options.entries ?? ROUND_ONE) : options.text;
    if (text !== null) {
        await writeFile(join(dir, FINDINGS_FILE), text);
    }
    const fake = options.port ?? fakePort();
    const walkthroughs: Harness["walkthroughs"] = [];
    const outcome = options.walkthrough ?? { outcome: "saved", digest: "0f".repeat(32) };
    const deps: PublishDeps = {
        config: config(),
        state,
        pullRequests: () => fake.port,
        git: fakeGit({ ahead: options.ahead, diff: options.diff }),
        plannotatorIn: () => plannotatorExec(options.plannotator === true),
        walkthrough: (input, plannotator) => {
            walkthroughs.push({ input, plannotator });
            return Promise.resolve(outcome);
        },
        wait: () => Promise.resolve(),
    };
    return { deps, dir, text, fake, walkthroughs };
}

const publish = (harness: Harness, id: AttemptId = ATTEMPT) =>
    runPublish(id, harness.deps, STARTED);

const POSTS: readonly string[] = ["review", "reply", "resolve", "unresolve"];

const posts = (calls: readonly string[]) =>
    calls.filter((call) => POSTS.includes(call.split(" ")[0] ?? ""));

const findingOf = (thread: ReviewThread) => threadMarker(thread.comments[0]?.body ?? "")?.finding;

const threadFor = (fake: FakePort, id: string) =>
    fake.threads.find((item) => findingOf(item) === id);

const human = (id: string, body = "This retry never stops.", overrides = {}) =>
    thread(id, [body], overrides);

// A thread an attempt published for `entry`, as publish mode wrote it.
function published(id: string, attempt: string, entry: RecordEntry, resolved: boolean) {
    const outcome = publicationOf(entry);
    if (outcome === null) {
        throw new Error(`${entry.id} is not published`);
    }
    return thread(id, [firstComment(attempt, entry, outcome)], { resolved });
}

function fixedByHuman(overrides: Partial<FindingEntry>): FindingEntry {
    return finding({
        round: 2,
        reporters: [{ reviewer: "human", ids: [] }],
        ...overrides,
    });
}

describe("runPublish: one review per round that opens threads", () => {
    it("First round: four new threads in one COMMENT review, its body a three-line index", async () => {
        const harness = await setup();
        const report = await publish(harness);
        expect(report.outcome).toBe("advance");
        expect(harness.fake.reviews).toHaveLength(1);
        const [review] = harness.fake.reviews;
        expect(review?.threads.map(({ body }) => threadMarker(body)?.finding)).toEqual([
            "f1",
            "f4",
            "f5",
            "d1",
        ]);
        expect(review?.body.split("\n")).toEqual([
            "Code review, round 1",
            "Threads: 2 open, 2 resolved",
            "Review team: tier M, skipped coderabbit (rate limited)",
            "<!-- autonomous:review v1 attempt=linear:DOT-121:code-review:1 round=1 -->",
        ]);
        expect(review?.threads.map(({ anchor }) => anchor)).toEqual([
            { kind: "line", path: "src/retry.ts", line: 12, side: "RIGHT" },
            { kind: "line", path: "src/retry.ts", line: 12, side: "RIGHT" },
            { kind: "line", path: "src/retry.ts", line: 12, side: "RIGHT" },
            { kind: "file", path: `openspec/changes/${CHANGE}/proposal.md` },
        ]);
        expect(report.reviews).toEqual([{ round: 1, url: `${PR_URL}#pullrequestreview-1` }]);
        expect(report.threads.opened.map(({ finding: id }) => id)).toEqual([
            "f1",
            "f4",
            "f5",
            "d1",
        ]);
        expect(report.threads.resolved.map(({ finding: id }) => id)).toEqual(["f1", "f5"]);
        expect(report.threads.answered).toEqual([]);
        expect(threadFor(harness.fake, "f1")?.resolved).toBe(true);
        expect(threadFor(harness.fake, "f4")?.resolved).toBe(false);
        expect(threadFor(harness.fake, "d1")?.resolved).toBe(false);
    });

    it("Human round with replies only: no review, and each of the two threads gains a reply", async () => {
        const port = fakePort({ threads: [human("H1"), human("H2", "Rename it.", { line: 41 })] });
        const harness = await setup({
            port,
            entries: [
                fixedByHuman({ id: "h1", thread: "H1" }),
                fixedByHuman({
                    id: "h2",
                    title: "Rename it.",
                    publication: { state: "fixed", commit: "def5678" },
                    thread: "H2",
                }),
            ],
        });
        const report = await publish(harness);
        expect(report.outcome).toBe("advance");
        expect(port.reviews).toEqual([]);
        expect(report.reviews).toEqual([]);
        expect(port.threads.map((item) => item.comments.length)).toEqual([2, 2]);
        expect(report.threads.answered.map(({ finding: id }) => id)).toEqual(["h1", "h2"]);
    });

    it("puts a finding no thread can hold in the round's review body", async () => {
        const nowhere = finding({ id: "f9", location: { scope: "file", file: "docs/absent.md" } });
        // A diff without the change's proposal, so the proposal cannot hold it either.
        const diff = DIFF.split("diff --git a/openspec")[0] ?? "";
        const harness = await setup({ entries: [finding(), nowhere], diff });
        const report = await publish(harness);
        expect(report.outcome).toBe("advance");
        const [review] = harness.fake.reviews;
        expect(review?.threads).toHaveLength(1);
        expect(review?.body).toContain("<!-- autonomous:finding v1 attempt=");
        expect(review?.body).toContain("finding=f9");
    });
});

describe("runPublish: existing threads are answered, never duplicated", () => {
    it("Human comment fixed: the thread gains a reply naming the commit and is resolved", async () => {
        const port = fakePort({ threads: [human("H1")] });
        const harness = await setup({ port, entries: [fixedByHuman({ id: "h1", thread: "H1" })] });
        const report = await publish(harness);
        expect(report.outcome).toBe("advance");
        expect(posts(port.calls)).toEqual(["reply H1", "resolve H1"]);
        const [, reply] = port.threads[0]?.comments ?? [];
        expect(reply?.body).toContain("Status: fixed in abc1234");
        expect(parseMarkers(reply?.body ?? "")).toEqual([
            { kind: "resolution", attempt: ATTEMPT, finding: "h1", state: "fixed" },
        ]);
        expect(port.threads[0]?.resolved).toBe(true);
        expect(report.threads.resolved).toEqual([
            { finding: "h1", url: `${PR_URL}#discussion-H1-0` },
        ]);
    });

    it("Earlier fix that did not hold: a second attempt replies and unresolves", async () => {
        const earlier = published("E1", ATTEMPT, finding(), true);
        const port = fakePort({ threads: [earlier] });
        const again = finding({
            id: "f7",
            publication: { state: "blocked", reason: "the fix needs a schema change" },
            thread: "E1",
        });
        const harness = await setup({ id: SECOND, port, entries: [again] });
        const report = await publish(harness, SECOND);
        expect(report.outcome).toBe("advance");
        expect(posts(port.calls)).toEqual(["reply E1", "unresolve E1"]);
        expect(port.threads[0]?.comments.at(-1)?.body).toContain(
            "Status: blocked: the fix needs a schema change",
        );
        expect(port.threads[0]?.resolved).toBe(false);
        expect(report.threads.unresolved.map(({ finding: id }) => id)).toEqual(["f7"]);
    });

    it("refuses, before any post, an entry linked to a thread the pull request does not hold", async () => {
        const harness = await setup({ entries: [fixedByHuman({ id: "h1", thread: "GONE" })] });
        const report = await publish(harness);
        expect(report.outcome).toBe("not-evaluable");
        expect(report.reasons.join("\n")).toContain("GONE");
        expect(posts(harness.fake.calls)).toEqual([]);
    });
});

describe("runPublish: publishing is idempotent within an attempt", () => {
    it("Mode run twice: the second run posts nothing and succeeds", async () => {
        const harness = await setup();
        expect((await publish(harness)).outcome).toBe("advance");
        const before = harness.fake.calls.length;
        const second = await publish(harness);
        expect(second.outcome).toBe("advance");
        expect(posts(harness.fake.calls.slice(before))).toEqual([]);
        expect(second.threads).toEqual({ opened: [], answered: [], resolved: [], unresolved: [] });
        expect(existsSync(join(harness.dir, PUBLISH_RECEIPT_FILE))).toBe(true);
    });

    it("Run cut short: the next run resolves the fixed threads and posts no second review", async () => {
        const port = fakePort({ failing: { method: "resolve", error: "secondary rate limit" } });
        const harness = await setup({ port });
        const cut = await publish(harness);
        expect(cut.outcome).toBe("not-evaluable");
        expect(cut.reasons).toEqual(["secondary rate limit"]);
        expect(existsSync(join(harness.dir, PUBLISH_RECEIPT_FILE))).toBe(false);
        port.options.failing = undefined;
        const before = port.calls.length;
        const next = await publish(harness);
        expect(next.outcome).toBe("advance");
        expect(port.reviews).toHaveLength(1);
        expect(posts(port.calls.slice(before))).toEqual(["resolve T1", "resolve T3"]);
    });

    it("tells a proposed deferral from a created one, which share the state deferred", async () => {
        const proposed = finding({
            id: "f5",
            destination: "defer",
            publication: { state: "deferred", proposedTitle: "Stop retrying revoked tokens" },
        });
        const harness = await setup({ entries: [proposed] });
        await publish(harness);
        const created = finding({
            ...proposed,
            publication: { state: "deferred", followUp: "https://linear.app/x/issue/DOT-170" },
        });
        await writeFile(join(harness.dir, FINDINGS_FILE), textOf(ATTEMPT, [created]));
        const before = harness.fake.calls.length;
        const report = await publish(harness);
        expect(report.outcome).toBe("advance");
        expect(posts(harness.fake.calls.slice(before))).toEqual(["reply T1", "resolve T1"]);
    });
});

describe("runPublish: an exact match continues an existing thread", () => {
    it("Same finding found again: a reply in that thread, reported as a match", async () => {
        const earlier = published("E1", ATTEMPT, finding(), false);
        const port = fakePort({ threads: [earlier] });
        const again = finding({
            id: "f2",
            title: "the  retry loop never STOPS when the token is revoked.",
            publication: { state: "fixed", commit: "def5678" },
        });
        const harness = await setup({ id: SECOND, port, entries: [again] });
        const report = await publish(harness, SECOND);
        expect(report.outcome).toBe("advance");
        expect(port.reviews).toEqual([]);
        expect(posts(port.calls)).toEqual(["reply E1", "resolve E1"]);
        expect(report.matches).toEqual([{ finding: "f2", url: `${PR_URL}#discussion-E1-0` }]);
        const reply = port.threads[0]?.comments[1]?.body ?? "";
        expect(reply).toContain("Status: fixed in def5678");
        expect(parseMarkers(reply)).toEqual([
            { kind: "resolution", attempt: SECOND, finding: "f2", state: "fixed" },
        ]);
        const rerun = await publish(harness, SECOND);
        expect(rerun.matches).toEqual([]);
        expect(port.reviews).toEqual([]);
    });

    it("opens a new thread when the line range differs", async () => {
        const earlier = published("E1", ATTEMPT, finding(), false);
        const port = fakePort({ threads: [{ ...earlier, startLine: 11 }] });
        const harness = await setup({ id: SECOND, port, entries: [finding({ id: "f2" })] });
        const report = await publish(harness, SECOND);
        expect(report.matches).toEqual([]);
        expect(port.reviews).toHaveLength(1);
    });
});

describe("runPublish: only the stage's own threads are touched", () => {
    it("Bot thread: an open CodeRabbit thread no entry links to is left untouched", async () => {
        const bot = thread("BOT", [
            "issue: The retry loop never stops when the token is revoked.\n\n_coderabbit_",
        ]);
        const port = fakePort({ threads: [bot] });
        const harness = await setup({ port, entries: [finding()] });
        const report = await publish(harness);
        expect(report.outcome).toBe("advance");
        expect(port.calls.filter((call) => call.includes("BOT"))).toEqual([]);
        expect(port.threads[0]).toEqual(bot);
        expect(report.matches).toEqual([]);
        expect(port.reviews).toHaveLength(1);
    });

    it("leaves another stage's thread alone when no entry links to it", async () => {
        const verify = published("V1", "linear:DOT-121:verify:1", finding(), false);
        const port = fakePort({ threads: [verify] });
        const harness = await setup({ port, entries: [finding()] });
        await publish(harness);
        expect(port.calls.filter((call) => call.includes("V1"))).toEqual([]);
    });
});

describe("runPublish: the publish receipt", () => {
    it("Receipt written: names the pull request and the digest of the record", async () => {
        const harness = await setup();
        const report = await publish(harness);
        const file = join(harness.dir, PUBLISH_RECEIPT_FILE);
        expect(report.receipt).toBe(file);
        expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({
            schema: "autonomous.published.v1",
            attempt: ATTEMPT,
            pullRequest: { number: 7, url: PR_URL },
            findingsDigest: digestOf(harness.text ?? ""),
            walkthroughDigest: "0f".repeat(32),
            publishedAt: STARTED.toISOString(),
        });
    });

    it("Read-back fails: a thread the run resolved reads back open, so no receipt and exit 3", async () => {
        const port = fakePort({ sticky: false });
        const harness = await setup({ port });
        const report = await publish(harness);
        expect(report.outcome).toBe("not-evaluable");
        expect(report.reasons.join("\n")).toContain("the thread of f1 is open");
        expect(report.receipt).toBeNull();
        expect(existsSync(join(harness.dir, PUBLISH_RECEIPT_FILE))).toBe(false);
        expect(harness.walkthroughs).toEqual([]);
    });

    it("passes the walkthrough every finding read back and records its outcome", async () => {
        const harness = await setup({
            plannotator: false,
            walkthrough: { outcome: "none", reason: "Plannotator is not available (gone)" },
        });
        const report = await publish(harness);
        expect(report.walkthrough).toEqual({
            outcome: "none",
            reason: "Plannotator is not available (gone)",
        });
        const [call] = harness.walkthroughs;
        expect(call?.plannotator).toEqual({
            available: false,
            reason: "plannotator CLI not found on PATH",
        });
        expect(call?.input).toMatchObject({
            attemptDir: harness.dir,
            patch: DIFF,
            pullRequestUrl: PR_URL,
            lastDigest: null,
        });
        expect(call?.input.notes.map((note) => [note.finding, note.label, note.status])).toEqual([
            ["f1", "issue (blocking)", "fixed in abc1234"],
            ["f4", "issue", "passed on to QA #qa"],
            ["f5", "issue", "deferred to https://linear.app/monolab/issue/DOT-170"],
            ["d1", "question (blocking)", "open question"],
        ]);
        const receipt = JSON.parse(
            readFileSync(join(harness.dir, PUBLISH_RECEIPT_FILE), "utf8"),
        ) as { walkthroughDigest: unknown };
        expect(receipt.walkthroughDigest).toBeNull();
    });

    it("hands the walkthrough Plannotator and the last saved digest", async () => {
        const harness = await setup({ plannotator: true });
        await publish(harness);
        await publish(harness);
        const [first, second] = harness.walkthroughs;
        expect(first?.plannotator.available).toBe(true);
        expect(first?.input.lastDigest).toBeNull();
        expect(second?.input.lastDigest).toBe("0f".repeat(32));
    });
});

describe("runPublish: comments are posted with the user's account", () => {
    it("Human comment beside a stage's: only the stage's comment carries a hidden marker", async () => {
        const port = fakePort({ threads: [human("H1")] });
        const harness = await setup({ port, entries: [fixedByHuman({ id: "h1", thread: "H1" })] });
        await publish(harness);
        const comments = port.threads[0]?.comments ?? [];
        expect(comments.map(({ author }) => author)).toEqual(["me", "me"]);
        expect(comments.map(({ body }) => parseMarkers(body).length)).toEqual([0, 1]);
    });

    it("never takes a marker-less thread of the same account for a code review thread", async () => {
        const lookalike = human(
            "H1",
            "issue: The retry loop never stops when the token is revoked.",
        );
        const port = fakePort({ threads: [lookalike] });
        const harness = await setup({ id: SECOND, port, entries: [finding()] });
        const report = await publish(harness, SECOND);
        expect(report.matches).toEqual([]);
        expect(port.calls.filter((call) => call.includes("H1"))).toEqual([]);
    });
});

describe("runPublish: publishing leaves the pull request a draft", () => {
    it("Draft kept: the run only reads, posts COMMENT reviews, replies and resolutions", async () => {
        const port = fakePort({ threads: [human("H1")] });
        const harness = await setup({
            port,
            entries: [...ROUND_ONE, fixedByHuman({ id: "h1", thread: "H1" })],
        });
        await publish(harness);
        await publish(harness);
        const methods = new Set(port.calls.map((call) => call.split(" ")[0]));
        expect([...methods].sort()).toEqual([
            "defaultBranch",
            "find",
            "pendingReview",
            "reply",
            "resolve",
            "review",
            "threads",
        ]);
    });
});

describe("runPublish: an invalid record publishes nothing", () => {
    it("Missing destination: nothing is posted, the reason names the entry and the field", async () => {
        const { destination: _, ...broken } = finding({ id: "f3" });
        const harness = await setup({ text: recordText([broken]) });
        const report = await publish(harness);
        expect(report.outcome).toBe("not-evaluable");
        expect(report.reasons).toHaveLength(1);
        expect(report.reasons[0]).toContain(join(harness.dir, FINDINGS_FILE));
        expect(report.reasons[0]).toContain("$.entries[f3].destination");
        expect(harness.fake.calls).toEqual([]);
        expect(report.receipt).toBeNull();
    });

    it("refuses a record that names another attempt", async () => {
        const harness = await setup({ text: textOf(SECOND, ROUND_ONE) });
        const report = await publish(harness);
        expect(report.reasons.join("\n")).toContain(`names ${SECOND}, not ${ATTEMPT}`);
        expect(harness.fake.calls).toEqual([]);
    });
});

describe("runPublish: a pending review of the account", () => {
    it("is refused before any post, naming its url", async () => {
        const pending = `${PR_URL}#pullrequestreview-99`;
        const port = fakePort({ pending });
        const harness = await setup({ port });
        const report = await publish(harness);
        expect(report.outcome).toBe("not-evaluable");
        expect(report.reasons.join("\n")).toContain(pending);
        expect(posts(port.calls)).toEqual([]);
    });
});

describe("runPublish: preconditions", () => {
    it("names the unpushed commits", async () => {
        const harness = await setup({ ahead: 1 });
        const report = await publish(harness);
        expect(report.reasons).toEqual([
            `the branch ${BRANCH} has 1 commit origin/${BRANCH} lacks: f00dfee`,
        ]);
        expect(posts(harness.fake.calls)).toEqual([]);
    });

    it("refuses an attempt of another stage", async () => {
        const id = "linear:DOT-121:verify:1" as AttemptId;
        const harness = await setup({ id });
        const report = await publish(harness, id);
        expect(report.reasons).toEqual([
            `attempt ${id} belongs to the verify stage; publish mode publishes code-review attempts only`,
        ]);
        expect(harness.fake.calls).toEqual([]);
    });

    it("names the missing record", async () => {
        const harness = await setup({ text: null });
        const report = await publish(harness);
        expect(report.reasons).toEqual([`${join(harness.dir, FINDINGS_FILE)} is missing`]);
    });
});

describe("renderPublishText", () => {
    it("lists the posts, the walkthrough and the receipt", async () => {
        const harness = await setup();
        const report: PublishReport = await publish(harness);
        expect(report.schema).toBe(PUBLISH_SCHEMA);
        const text = renderPublishText(report);
        expect(text).toContain("outcome: advance");
        expect(text).toContain("threads opened:\n  - f1: ");
        expect(text).toContain("exact matches: none");
        expect(text).toContain(`round 1: ${PR_URL}#pullrequestreview-1`);
        expect(text).toContain("walkthrough: saved");
        expect(text).toContain(`receipt: ${join(harness.dir, PUBLISH_RECEIPT_FILE)}`);
    });
});
