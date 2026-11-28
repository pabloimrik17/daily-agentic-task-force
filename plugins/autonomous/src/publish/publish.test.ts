import { existsSync, readFileSync, rmSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { type AttemptId, attemptId } from "../attempts/record.ts";
import { attemptDir, publishLockPath, writeRecord } from "../attempts/state.ts";
import { record as startedAttempt, tempState } from "../attempts/test-fixtures.ts";
import type { Exec, ExecResult } from "../exec.ts";
import { config } from "../label-triage/test-fixtures.ts";
import type {
    NewThread,
    PullRequests,
    Review,
    ReviewThread,
    ThreadAnchor,
} from "../pull-request/port.ts";
import { READ_BACK_TRIES } from "../read-back.ts";
import type { Result } from "../result.ts";
import type { ReviewBot } from "../review-bots/types.ts";
import type { StageId } from "../stages/stage.ts";
import { firstComment, stateReply } from "./format.ts";
import { parseMarkers, threadMarker } from "./markers.ts";
import { outcomeOf, publicationOf } from "./outcome.ts";
import { type PublishDeps, runPublish } from "./publish.ts";
import { digestOf, FINDINGS_FILE, isQuietReceipt, PUBLISH_RECEIPT_FILE } from "./receipt.ts";
import type { FindingEntry, RecordEntry } from "./record.ts";
import { PUBLISH_SCHEMA, renderPublishText, type PublishReport } from "./report.ts";
import {
    ATTEMPT,
    CHANGE,
    DIFF,
    doubt,
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
    reviews?: Review[]; // the pull request's reviews, which a quiet round reads and dismisses
    pending?: string | null;
    failing?: { method: Method; error: string }; // every call of that method fails
    sticky?: boolean; // false: resolve and unresolve succeed but change nothing
    lag?: number; // the thread reads after a review that still return the list before it
}

interface FakePort {
    port: PullRequests;
    calls: string[];
    threads: ReviewThread[];
    reviews: { body: string; threads: readonly NewThread[] }[];
    prReviews: Review[];
    dismissals: { review: string; message: string }[];
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
        prReviews: structuredClone(options.reviews ?? []),
        dismissals: [],
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
    let stale: { threads: ReviewThread[]; reads: number } | null = null;
    const listed = () => {
        if (stale === null || stale.reads === 0) {
            return structuredClone(fake.threads);
        }
        stale.reads -= 1;
        return structuredClone(stale.threads);
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
        threads: () => call("threads", "", listed),
        pendingReview: () => call("pendingReview", "", () => fake.options.pending ?? null),
        review: (_number, body, threads) =>
            call("review", String(threads.length), () => {
                fake.reviews.push({ body, threads });
                stale = { threads: structuredClone(fake.threads), reads: options.lag ?? 0 };
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
        state: unexpected("state"),
        ready: unexpected("ready"),
        checkRuns: unexpected("checkRuns"),
        reviews: () => call("reviews", "", () => structuredClone(fake.prReviews)),
        dismiss: (_number, review, message) =>
            call("dismiss", review, () => {
                fake.dismissals.push({ review, message });
                const found = fake.prReviews.find((item) => item.id === review);
                if (found !== undefined && fake.options.sticky !== false) {
                    found.state = "DISMISSED";
                }
            }),
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
    quiet?: boolean; // the record marks a quiet round
    bots?: readonly ReviewBot[]; // review.external.bots; BOTS by default
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

function textOf(id: AttemptId, entries: readonly RecordEntry[], quiet = false): string {
    const record = { ...findingsRecord(entries), attempt: id, ...(quiet ? { quiet: true } : {}) };
    return `${JSON.stringify(record, null, 2)}\n`;
}

// The shipped review bots, without mentions; GraphQL names their thread comments' authors
// without the `[bot]` suffix.
const BOTS: readonly ReviewBot[] = [
    { id: "coderabbit", login: "coderabbitai[bot]", check: "CodeRabbit", mention: null },
    { id: "greptile", login: "greptile-apps[bot]", check: "Greptile Review", mention: null },
    { id: "pullfrog", login: "pullfrog[bot]", check: "pullfrog", mention: null },
];

function configWith(bots: readonly ReviewBot[]): PublishDeps["config"] {
    const base = config();
    const external = { waitMinutes: 30, answerWaitMinutes: 10, rounds: 3, bots: [...bots] };
    return { ...base, review: { ...base.review, external } };
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
        options.text === undefined
            ? textOf(id, options.entries ?? ROUND_ONE, options.quiet)
            : options.text;
    if (text !== null) {
        await writeFile(join(dir, FINDINGS_FILE), text);
    }
    const fake = options.port ?? fakePort();
    const walkthroughs: Harness["walkthroughs"] = [];
    const outcome = options.walkthrough ?? { outcome: "saved", digest: "0f".repeat(32) };
    const deps: PublishDeps = {
        config: configWith(options.bots ?? BOTS),
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

const EXTERNAL = "linear:DOT-121:external-review:1" as AttemptId;
const QUIET = "linear:DOT-121:external-review:2" as AttemptId;
const GREPTILE = "greptile-apps";
const CODERABBIT = "coderabbitai";

// A review bot's thread: its first comment, and any given in `by`, are the bot's.
function botThread(
    id: string,
    author: string,
    bodies: string[],
    overrides: Partial<Omit<ReviewThread, "comments">> = {},
    by: readonly number[] = [0],
): ReviewThread {
    const made = thread(id, bodies, overrides);
    return {
        ...made,
        comments: made.comments.map((item, index) =>
            by.includes(index) ? { ...item, author } : item,
        ),
    };
}

function reportedBy(reviewer: string, overrides: Partial<FindingEntry> = {}): FindingEntry {
    return finding({ reporters: [{ reviewer, ids: [] }], ...overrides });
}

function refutedBy(reviewer: string, overrides: Partial<FindingEntry> = {}): FindingEntry {
    return reportedBy(reviewer, {
        refutation: { outcome: "refuted", reproduction: null },
        publication: { state: "none" },
        reason: "The token is checked before the loop.",
        ...overrides,
    });
}

// The reply an attempt posted for `entry`, as publish mode writes it.
function replyOf(attempt: string, entry: RecordEntry): string {
    const outcome = outcomeOf(entry);
    if (outcome === null) {
        throw new Error(`${entry.id} posts nothing`);
    }
    return stateReply(attempt, entry, outcome);
}

const lastBody = (item: ReviewThread | undefined) => item?.comments.at(-1)?.body ?? "";

function changesRequested(id: string, author: string): Review {
    return {
        id,
        author,
        state: "CHANGES_REQUESTED",
        commit: "0ddba11",
        body: "Please fix the loop.",
        url: `${PR_URL}#pullrequestreview-${id}`,
    };
}

// A quiet round of the second external review attempt, whose record holds no entry.
const quietRound = (port: FakePort, bots: readonly ReviewBot[] = BOTS) =>
    setup({ id: QUIET, port, entries: [], quiet: true, bots });

const POSTS: readonly string[] = ["review", "reply", "resolve", "unresolve", "dismiss"];

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

describe("runPublish: a finding no thread can hold, in a round that opens no thread", () => {
    const nowhere = finding({ id: "f9", location: { scope: "file", file: "docs/absent.md" } });
    // A diff without the change's proposal, so the proposal cannot hold it either.
    const diff = DIFF.split("diff --git a/openspec")[0] ?? "";
    const note =
        "f9 is not published: no thread can hold it, and round 1 opens no thread whose review could carry it";

    it("notes it when the round holds only a linked thread", async () => {
        const port = fakePort({ threads: [human("H1")] });
        const linked = finding({ id: "f2", thread: "H1" });
        const harness = await setup({ port, entries: [linked, nowhere], diff });
        const report = await publish(harness);
        expect(report.outcome).toBe("advance");
        expect(port.reviews).toEqual([]);
        expect(report.notes).toContain(note);
    });

    it("notes it when the round holds only an exact match of an earlier attempt", async () => {
        const port = fakePort({ threads: [published("E1", ATTEMPT, finding(), false)] });
        const harness = await setup({ id: SECOND, port, entries: [finding(), nowhere], diff });
        const report = await publish(harness, SECOND);
        expect(report.outcome).toBe("advance");
        expect(port.reviews).toEqual([]);
        expect(report.notes).toContain(note);
    });

    it("does not note it on a second run, whose first run's review carried it", async () => {
        const harness = await setup({ entries: [finding(), nowhere], diff });
        await publish(harness);
        const report = await publish(harness);
        expect(report.outcome).toBe("advance");
        expect(harness.fake.reviews).toHaveLength(1);
        expect(report.notes).not.toContain(note);
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

    it("Human suggestion fixed: the thread gains a reply naming the commit and is resolved, no new thread", async () => {
        const port = fakePort({ threads: [human("H1", "nit: rename it.")] });
        const nit = fixedByHuman({
            id: "h1",
            thread: "H1",
            severity: "SUGGESTION",
            label: "suggestion",
        });
        const unlinked = { ...nit, id: "h2", thread: null };
        const harness = await setup({ port, entries: [nit, unlinked] });
        const report = await publish(harness);
        expect(report.outcome).toBe("advance");
        expect(posts(port.calls)).toEqual(["reply H1", "resolve H1"]);
        expect(port.threads).toHaveLength(1);
        const [, reply] = port.threads[0]?.comments ?? [];
        expect(reply?.body).toContain("Status: fixed in abc1234");
        expect(parseMarkers(reply?.body ?? "")).toEqual([
            { kind: "resolution", attempt: ATTEMPT, finding: "h1", state: "fixed" },
        ]);
        expect(port.threads[0]?.resolved).toBe(true);
        expect(report.threads.answered.map(({ finding: id }) => id)).toEqual(["h1"]);
        expect(report.threads.resolved.map(({ finding: id }) => id)).toEqual(["h1"]);
        const before = port.calls.length;
        expect((await publish(harness)).outcome).toBe("advance");
        expect(posts(port.calls.slice(before))).toEqual([]);
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

    it("Two entries in one thread, one open: both are answered and the thread stays open", async () => {
        const port = fakePort({ threads: [human("H1")] });
        const fixed = fixedByHuman({ id: "h1", thread: "H1" });
        const blocked = fixedByHuman({
            id: "h2",
            round: 3,
            thread: "H1",
            publication: { state: "blocked", reason: "needs the owner" },
        });
        const harness = await setup({ port, entries: [fixed, blocked] });
        const report = await publish(harness);
        expect(report.outcome).toBe("advance");
        expect(posts(port.calls)).toEqual(["reply H1", "reply H1"]);
        expect(port.threads[0]?.resolved).toBe(false);
        const before = port.calls.length;
        expect((await publish(harness)).outcome).toBe("advance");
        expect(posts(port.calls.slice(before))).toEqual([]);
    });

    it("Two entries in one thread, both fixed: the thread is resolved once", async () => {
        const port = fakePort({ threads: [human("H1")] });
        const first = fixedByHuman({ id: "h1", thread: "H1" });
        const second = fixedByHuman({
            id: "h2",
            round: 3,
            thread: "H1",
            publication: { state: "fixed", commit: "def5678" },
        });
        const harness = await setup({ port, entries: [first, second] });
        const report = await publish(harness);
        expect(report.outcome).toBe("advance");
        expect(posts(port.calls)).toEqual(["reply H1", "resolve H1", "reply H1"]);
        expect(report.threads.resolved).toHaveLength(1);
    });

    it("refuses, before any post, an entry linked to a thread the pull request does not hold", async () => {
        const harness = await setup({ entries: [fixedByHuman({ id: "h1", thread: "GONE" })] });
        const report = await publish(harness);
        expect(report.outcome).toBe("not-evaluable");
        expect(report.reasons.join("\n")).toContain("GONE");
        expect(posts(harness.fake.calls)).toEqual([]);
    });

    it("Linked entry of an external review: the bot's thread gains a reply naming the commit, and is not resolved", async () => {
        const port = fakePort({
            threads: [botThread("G1", GREPTILE, ["**P1** The loop never stops."])],
        });
        const entry = reportedBy("greptile", { id: "g1", thread: "G1" });
        const harness = await setup({ id: EXTERNAL, port, entries: [entry] });
        const report = await publish(harness, EXTERNAL);
        expect(report.outcome).toBe("advance");
        expect(posts(port.calls)).toEqual(["reply G1"]);
        expect(lastBody(port.threads[0])).toContain("Status: fixed in abc1234");
        expect(port.threads[0]?.resolved).toBe(false);
        expect(report.threads.resolved).toEqual([]);
    });

    it("never unresolves a review bot's thread an external review answers as open again", async () => {
        const resolved = botThread("C1", CODERABBIT, ["The loop never stops."], { resolved: true });
        const port = fakePort({ threads: [resolved] });
        const entry = reportedBy("coderabbit", {
            id: "c1",
            thread: "C1",
            publication: { state: "blocked", reason: "needs the owner" },
        });
        const harness = await setup({ id: EXTERNAL, port, entries: [entry] });
        expect((await publish(harness, EXTERNAL)).outcome).toBe("advance");
        expect(posts(port.calls)).toEqual(["reply C1"]);
        expect(port.threads[0]?.resolved).toBe(true);
    });
});

describe("runPublish: a linked entry that is not published is answered", () => {
    const refuted = (overrides: Partial<FindingEntry> = {}) =>
        finding({
            id: "f4",
            thread: "E1",
            reason: "No input makes it loop: the guard in `read` stops it.",
            refutation: { outcome: "refuted", reproduction: null },
            publication: { state: "none" },
            ...overrides,
        });

    const asked = () => published("E1", ATTEMPT, doubt({ id: "d2" }), false);

    const lastBody = (fake: FakePort, id: string) =>
        fake.threads.find((item) => item.id === id)?.comments.at(-1)?.body;

    it("Linked entry refuted: one reply with its outcome, the thread's state unchanged", async () => {
        const port = fakePort({ threads: [asked()] });
        const harness = await setup({ id: SECOND, port, entries: [refuted()] });
        const report = await publish(harness, SECOND);
        expect(report.outcome).toBe("advance");
        expect(posts(port.calls)).toEqual(["reply E1"]);
        expect(lastBody(port, "E1")).toBe(
            [
                "Status: not published (refuted): No input makes it loop: the guard in `read` stops it.",
                `<!-- autonomous:resolution v1 attempt=${SECOND} finding=f4 state=none -->`,
            ].join("\n"),
        );
        expect(port.threads[0]?.resolved).toBe(false);
        expect(report.threads.answered).toEqual([
            { finding: "f4", url: `${PR_URL}#discussion-E1-0` },
        ]);
        expect(report.threads.resolved).toEqual([]);
        expect(report.threads.unresolved).toEqual([]);
    });

    it("Linked entry dismissed or settled: one reply with its outcome, the thread's state unchanged", async () => {
        const port = fakePort({
            threads: [asked(), published("E2", ATTEMPT, finding({ id: "f2" }), true)],
        });
        const dismissed = refuted({
            id: "f5",
            destination: "dismiss",
            refutation: { outcome: "not-refuted", reproduction: null },
            reason: "The project's style allows it.",
        });
        const settled = doubt({
            id: "d3",
            thread: "E2",
            destination: "settled",
            reason: "The definition answers it.",
        });
        const entries = [dismissed, settled];
        const harness = await setup({ id: SECOND, port, entries });
        const report = await publish(harness, SECOND);
        expect(report.outcome).toBe("advance");
        expect(posts(port.calls)).toEqual(["reply E1", "reply E2"]);
        expect(lastBody(port, "E1")).toContain(
            "Status: not published (dismissed): The project's style allows it.",
        );
        expect(lastBody(port, "E2")).toContain(
            "Status: not published (settled): The definition answers it.",
        );
        expect(port.threads.map((item) => item.resolved)).toEqual([false, true]);
        expect(report.threads.answered.map(({ finding: id }) => id)).toEqual(["f5", "d3"]);
    });

    it("Human's finding withdrawn: the human's thread gains a reply and keeps its state", async () => {
        const port = fakePort({
            threads: [human("H1"), human("H2", "Rename it.", { resolved: true })],
        });
        const withdrawn = (id: string, at: string) =>
            fixedByHuman({
                id,
                thread: at,
                destination: "dismiss",
                refutation: { outcome: "not-refuted", reproduction: null },
                publication: { state: "none" },
                reason: "The human dropped it after the advisory refutation.",
            });
        const entries = [withdrawn("h1", "H1"), withdrawn("h2", "H2")];
        const harness = await setup({ port, entries });
        const report = await publish(harness);
        expect(report.outcome).toBe("advance");
        expect(posts(port.calls)).toEqual(["reply H1", "reply H2"]);
        expect(lastBody(port, "H1")).toContain("Status: not published (dismissed): The human");
        expect(port.threads.map((item) => item.resolved)).toEqual([false, true]);
        expect(report.threads.answered.map(({ finding: id }) => id)).toEqual(["h1", "h2"]);
    });

    it("Second run in the same attempt: no second reply", async () => {
        const port = fakePort({ threads: [asked()] });
        const harness = await setup({ id: SECOND, port, entries: [refuted()] });
        expect((await publish(harness, SECOND)).outcome).toBe("advance");
        const before = port.calls.length;
        const second = await publish(harness, SECOND);
        expect(second.outcome).toBe("advance");
        expect(posts(port.calls.slice(before))).toEqual([]);
        expect(port.threads[0]?.comments).toHaveLength(2);
        expect(second.threads.answered).toEqual([]);
    });

    it("Unpublished entry with no linked thread: nothing is posted", async () => {
        const port = fakePort({ threads: [asked()] });
        const harness = await setup({ id: SECOND, port, entries: [refuted({ thread: null })] });
        const report = await publish(harness, SECOND);
        expect(report.outcome).toBe("advance");
        expect(posts(port.calls)).toEqual([]);
        expect(port.threads[0]?.comments).toHaveLength(1);
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

    it("reads back a blocked reason that ends in a space", async () => {
        const port = fakePort({ threads: [human("H1")] });
        const blocked = fixedByHuman({
            thread: "H1",
            publication: { state: "blocked", reason: "needs owner " },
        });
        const harness = await setup({ port, entries: [blocked] });
        expect((await publish(harness)).outcome).toBe("advance");
        expect(port.threads[0]?.comments[1]?.body).toContain("Status: blocked: needs owner\n");
        const before = port.calls.length;
        expect((await publish(harness)).outcome).toBe("advance");
        expect(posts(port.calls.slice(before))).toEqual([]);
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

describe("runPublish: the thread read that follows a review can lag it", () => {
    it("waits the lag out and publishes", async () => {
        const port = fakePort({ lag: 2 });
        const report = await publish(await setup({ port }));
        expect(report.outcome).toBe("advance");
        expect(port.reviews).toHaveLength(1);
        expect(report.threads.opened).toHaveLength(4);
    });

    it("names the tries when the threads never show", async () => {
        const port = fakePort({ lag: 99 });
        const report = await publish(await setup({ port }));
        expect(report.outcome).toBe("not-evaluable");
        expect(report.reasons).toEqual([
            `the review was posted but pull request #7 holds no thread for f1 (${READ_BACK_TRIES})`,
        ]);
    });
});

describe("runPublish: one publication per attempt at a time", () => {
    it("posts each round's review once when two runs of one attempt overlap", async () => {
        const harness = await setup();
        const reports = await Promise.all([publish(harness), publish(harness)]);
        expect(reports.map(({ outcome }) => outcome).sort()).toEqual(["advance", "not-evaluable"]);
        expect(harness.fake.reviews).toHaveLength(1);
        const refused = reports.find(({ outcome }) => outcome === "not-evaluable");
        const lock = publishLockPath(harness.dir);
        expect(refused?.reasons[0]).toContain(`another publication holds ${lock}`);
    });

    it("reads the findings only once it holds the lock", async () => {
        const harness = await setup({ text: null });
        const lock = publishLockPath(harness.dir);
        await writeFile(lock, JSON.stringify({ pid: process.pid, startedAt: "t" }));
        const report = await publish(harness);
        expect(report.reasons).toEqual([
            `another publication holds ${lock} (pid ${process.pid}, started t)`,
        ]);
    });

    it("releases the lock when it ends, published or failed", async () => {
        const done = await setup();
        await publish(done);
        expect(existsSync(publishLockPath(done.dir))).toBe(false);

        const port = fakePort({ failing: { method: "review", error: "gh api failed" } });
        const failed = await setup({ port });
        expect((await publish(failed)).reasons).toEqual(["gh api failed"]);
        expect(existsSync(publishLockPath(failed.dir))).toBe(false);
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

    it("leaves a thread another entry is linked to, whichever comes first in the record", async () => {
        const earlier = published("E1", ATTEMPT, finding(), false);
        const port = fakePort({ threads: [earlier] });
        const unlinked = finding({ id: "f2", publication: { state: "fixed", commit: "def5678" } });
        const linked = finding({
            id: "f3",
            thread: "E1",
            publication: { state: "blocked", reason: "needs the owner" },
        });
        const harness = await setup({ id: SECOND, port, entries: [unlinked, linked] });
        const report = await publish(harness, SECOND);
        expect(report.outcome).toBe("advance");
        expect(report.matches).toEqual([]);
        expect(posts(port.calls)).toEqual(["review 1", "resolve T2", "reply E1"]);
    });

    it("reads its own status line, not a statement's line that starts the same way", async () => {
        const earlier = published("E1", ATTEMPT, finding(), false);
        const port = fakePort({ threads: [earlier] });
        const again = finding({
            id: "f2",
            statement: "Status: reproduced locally\nA revoked token makes `retry` loop forever.",
            publication: { state: "fixed", commit: "def5678" },
        });
        const harness = await setup({ id: SECOND, port, entries: [again] });
        expect((await publish(harness, SECOND)).outcome).toBe("advance");
        const before = port.calls.length;
        expect((await publish(harness, SECOND)).outcome).toBe("advance");
        expect(posts(port.calls.slice(before))).toEqual([]);
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
    it("Bot thread linked by an external review: publish mode replies in that thread", async () => {
        const port = fakePort({
            threads: [botThread("C1", CODERABBIT, ["The loop never stops."])],
        });
        const entry = refutedBy("coderabbit", { id: "c1", thread: "C1" });
        const harness = await setup({ id: EXTERNAL, port, entries: [entry] });
        expect((await publish(harness, EXTERNAL)).outcome).toBe("advance");
        expect(posts(port.calls)).toEqual(["reply C1"]);
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
            `attempt ${id} belongs to the verify stage; publish mode publishes code-review and external-review attempts only`,
        ]);
        expect(harness.fake.calls).toEqual([]);
    });

    it("names the missing record", async () => {
        const harness = await setup({ text: null });
        const report = await publish(harness);
        expect(report.reasons).toEqual([`${join(harness.dir, FINDINGS_FILE)} is missing`]);
    });
});

describe("runPublish: an external review holds the threads it answers open", () => {
    it("Refuted bot finding: the Greptile thread gains one reply, not published (refuted) with the reason, and stays open", async () => {
        const port = fakePort({
            threads: [botThread("G1", GREPTILE, ["**P2** The loop never stops."])],
        });
        const entry = refutedBy("greptile", { id: "g1", thread: "G1" });
        const harness = await setup({ id: EXTERNAL, port, entries: [entry] });
        expect((await publish(harness, EXTERNAL)).outcome).toBe("advance");
        expect((await publish(harness, EXTERNAL)).outcome).toBe("advance");
        const replies = port.threads[0]?.comments.slice(1) ?? [];
        expect(replies).toHaveLength(1);
        expect(replies[0]?.body).toContain(
            "Status: not published (refuted): The token is checked before the loop.",
        );
        expect(parseMarkers(replies[0]?.body ?? "")).toEqual([
            { kind: "resolution", attempt: EXTERNAL, finding: "g1", state: "none" },
        ]);
        expect(port.threads[0]?.resolved).toBe(false);
        expect(posts(port.calls)).toEqual(["reply G1"]);
    });

    it("Already decided by the code review: the reply says not published (dismissed), gives the reason and holds that URL", async () => {
        const decision = "https://github.com/o/r/pull/9#discussion_r1";
        const port = fakePort({
            threads: [botThread("C1", CODERABBIT, ["The loop never stops."])],
        });
        const entry = reportedBy("coderabbit", {
            id: "c1",
            thread: "C1",
            destination: "dismiss",
            refutation: { outcome: "not-refuted", reproduction: null },
            publication: { state: "none" },
            reason: `Decided in the code review, ${decision}: a revoked token is retried once.`,
        });
        const harness = await setup({ id: EXTERNAL, port, entries: [entry] });
        expect((await publish(harness, EXTERNAL)).outcome).toBe("advance");
        const reply = lastBody(port.threads[0]);
        expect(reply).toContain("Status: not published (dismissed): Decided in the code review");
        expect(reply).toContain("a revoked token is retried once.");
        expect(reply).toContain(decision);
        expect(port.threads[0]?.resolved).toBe(false);
    });

    it("Finding thread addressed to external review: the thread gains a reply naming the commit and is resolved", async () => {
        const passed = finding({
            destination: "pass-on",
            refutation: { outcome: "not-refuted", reproduction: null },
            publication: { state: "passed-on", stage: "external-review" },
        });
        const addressed = published("P1", ATTEMPT, passed, false);
        expect(threadMarker(addressed.comments[0]?.body ?? "")?.for).toBe("external-review");
        const port = fakePort({ threads: [addressed] });
        const harness = await setup({
            id: EXTERNAL,
            port,
            entries: [finding({ id: "e1", thread: "P1" })],
        });
        expect((await publish(harness, EXTERNAL)).outcome).toBe("advance");
        expect(posts(port.calls)).toEqual(["reply P1", "resolve P1"]);
        expect(lastBody(port.threads[0])).toContain("Status: fixed in abc1234");
        expect(port.threads[0]?.resolved).toBe(true);
    });
});

describe("runPublish: a reply may mention its review bot", () => {
    it("No mention configured: the reply in a Greptile thread holds no @ mention of Greptile", async () => {
        const port = fakePort({
            threads: [botThread("G1", GREPTILE, ["**P1** The loop never stops."])],
        });
        const entry = reportedBy("greptile", { id: "g1", thread: "G1" });
        const harness = await setup({ id: EXTERNAL, port, entries: [entry] });
        expect((await publish(harness, EXTERNAL)).outcome).toBe("advance");
        expect(lastBody(port.threads[0])).not.toMatch(/@greptile/iu);
        expect(lastBody(port.threads[0]).startsWith("Status: ")).toBe(true);
    });

    it("Mention configured: the reply in a CodeRabbit thread starts with @coderabbitai", async () => {
        const bots = BOTS.map((bot) =>
            bot.id === "coderabbit" ? { ...bot, mention: "@coderabbitai" } : bot,
        );
        const port = fakePort({
            threads: [botThread("C1", CODERABBIT, ["The loop never stops."])],
        });
        const entry = refutedBy("coderabbit", { id: "c1", thread: "C1" });
        const harness = await setup({ id: EXTERNAL, port, entries: [entry], bots });
        expect((await publish(harness, EXTERNAL)).outcome).toBe("advance");
        expect(lastBody(port.threads[0]).startsWith("@coderabbitai")).toBe(true);
        expect((await publish(harness, EXTERNAL)).outcome).toBe("advance");
        expect(posts(port.calls)).toEqual(["reply C1"]);
    });

    it("does not mention a bot in its thread when another reporter's entry is answered there", async () => {
        const bots = BOTS.map((bot) =>
            bot.id === "coderabbit" ? { ...bot, mention: "@coderabbitai" } : bot,
        );
        const port = fakePort({
            threads: [botThread("C1", CODERABBIT, ["The loop never stops."])],
        });
        const entry = refutedBy("ci", { id: "c1", thread: "C1" });
        const harness = await setup({ id: EXTERNAL, port, entries: [entry], bots });
        expect((await publish(harness, EXTERNAL)).outcome).toBe("advance");
        expect(lastBody(port.threads[0])).not.toContain("@coderabbitai");
    });
});

describe("runPublish: the record may mark a quiet round", () => {
    it("Quiet mark on a code review record: nothing is posted, the report names the field, and the mode fails", async () => {
        const harness = await setup({ entries: [], quiet: true });
        const report = await publish(harness);
        expect(report.outcome).toBe("not-evaluable");
        expect(report.reasons.join("\n")).toContain("$.quiet");
        expect(harness.fake.calls).toEqual([]);
        expect(report.receipt).toBeNull();
    });

    it("refuses a quiet record of an external review that sends an entry to fix", async () => {
        const harness = await setup({ id: QUIET, entries: [reportedBy("greptile")], quiet: true });
        const report = await publish(harness, QUIET);
        expect(report.reasons.join("\n")).toContain("$.entries[f1] is sent to fix");
        expect(harness.fake.calls).toEqual([]);
    });
});

describe("runPublish: the quiet round resolves the answered threads", () => {
    it("Greptile thread answered as fixed: the thread is resolved", async () => {
        const entry = reportedBy("greptile", { id: "g1", thread: "G1" });
        const answered = botThread("G1", GREPTILE, [
            "**P1** The loop never stops.",
            replyOf(EXTERNAL, entry),
        ]);
        const port = fakePort({ threads: [answered] });
        const harness = await quietRound(port);
        const report = await publish(harness, QUIET);
        expect(report.outcome).toBe("advance");
        expect(posts(port.calls)).toEqual(["resolve G1"]);
        expect(port.threads[0]?.resolved).toBe(true);
        expect(report.threads.resolved).toEqual([
            { finding: "g1", url: `${PR_URL}#discussion-G1-0` },
        ]);
    });

    it("Bot answered after the reply: the CodeRabbit thread is left open", async () => {
        const entry = refutedBy("coderabbit", { id: "c1", thread: "C1" });
        const contested = botThread(
            "C1",
            CODERABBIT,
            [
                "The loop never stops.",
                replyOf(EXTERNAL, entry),
                "The check runs after the first send.",
            ],
            {},
            [0, 2],
        );
        const port = fakePort({ threads: [contested] });
        const harness = await quietRound(port);
        expect((await publish(harness, QUIET)).outcome).toBe("advance");
        expect(posts(port.calls)).toEqual([]);
        expect(port.threads[0]?.resolved).toBe(false);
    });

    it("Human reviewer's thread refuted: the thread is left open", async () => {
        const entry = refutedBy("human", { id: "h1", thread: "H1" });
        const port = fakePort({ threads: [human("H1", "This retry never stops.")] });
        port.threads[0]?.comments.push({ ...comment("H1", 1, replyOf(EXTERNAL, entry)) });
        const harness = await quietRound(port);
        expect((await publish(harness, QUIET)).outcome).toBe("advance");
        expect(lastBody(port.threads[0])).toContain("Status: not published (refuted)");
        expect(posts(port.calls)).toEqual([]);
    });

    it("resolves a human reviewer's thread whose finding was fixed", async () => {
        const entry = reportedBy("human", { id: "h1", thread: "H1" });
        const port = fakePort({ threads: [human("H1", "This retry never stops.")] });
        port.threads[0]?.comments.push({ ...comment("H1", 1, replyOf(EXTERNAL, entry)) });
        const harness = await quietRound(port);
        expect((await publish(harness, QUIET)).outcome).toBe("advance");
        expect(posts(port.calls)).toEqual(["resolve H1"]);
    });

    it("leaves open a thread whose last reply says blocked, or deferred to a proposed task", async () => {
        const blocked = reportedBy("greptile", {
            id: "g1",
            publication: { state: "blocked", reason: "needs the owner" },
        });
        const proposed = reportedBy("greptile", {
            id: "g2",
            destination: "defer",
            publication: { state: "deferred", proposedTitle: "Bound the retries" },
        });
        const port = fakePort({
            threads: [
                botThread("G1", GREPTILE, [
                    "**P1** The loop never stops.",
                    replyOf(EXTERNAL, blocked),
                ]),
                botThread("G2", GREPTILE, ["**P2** Bound it.", replyOf(EXTERNAL, proposed)]),
            ],
        });
        const harness = await quietRound(port);
        expect((await publish(harness, QUIET)).outcome).toBe("advance");
        expect(posts(port.calls)).toEqual([]);
    });
});

describe("runPublish: the quiet round dismisses a review bot's request for changes", () => {
    const fixed = reportedBy("coderabbit", { id: "c1", thread: "C1" });
    const answeredThread = () =>
        botThread("C1", CODERABBIT, ["The loop never stops.", replyOf(EXTERNAL, fixed)]);

    it("Every CodeRabbit thread resolved: that review is dismissed with a message starting Addressed:", async () => {
        const port = fakePort({
            threads: [answeredThread()],
            reviews: [changesRequested("R9", "coderabbitai[bot]")],
        });
        const harness = await quietRound(port);
        const report = await publish(harness, QUIET);
        expect(report.outcome).toBe("advance");
        expect(posts(port.calls)).toEqual(["resolve C1", "dismiss R9"]);
        expect(port.dismissals).toEqual([
            { review: "R9", message: "Addressed: 1 fixed, 0 answered" },
        ]);
        expect(report.dismissed).toEqual([
            { bot: "coderabbit", url: `${PR_URL}#pullrequestreview-R9` },
        ]);
    });

    it("One CodeRabbit thread left open: CodeRabbit's review is not dismissed", async () => {
        const contested = refutedBy("coderabbit", {
            id: "c2",
            thread: "C2",
            refutation: { outcome: "survived", reproduction: null },
            publication: { state: "blocked", reason: "refuted twice; the human decides" },
        });
        const port = fakePort({
            threads: [
                answeredThread(),
                botThread("C2", CODERABBIT, ["Bound it.", replyOf(EXTERNAL, contested)]),
            ],
            reviews: [changesRequested("R9", "coderabbitai[bot]")],
        });
        const harness = await quietRound(port);
        expect((await publish(harness, QUIET)).outcome).toBe("advance");
        expect(posts(port.calls)).toEqual(["resolve C1"]);
        expect(port.prReviews[0]?.state).toBe("CHANGES_REQUESTED");
    });

    it("Human request for changes: it is not dismissed", async () => {
        const port = fakePort({
            threads: [answeredThread()],
            reviews: [changesRequested("R8", "a-reviewer")],
        });
        const harness = await quietRound(port);
        expect((await publish(harness, QUIET)).outcome).toBe("advance");
        expect(port.calls.filter((call) => call.startsWith("dismiss"))).toEqual([]);
    });

    it("run twice, posts no second reply, resolution or dismissal, and never marks ready", async () => {
        const port = fakePort({
            threads: [answeredThread()],
            reviews: [changesRequested("R9", "coderabbitai[bot]")],
        });
        const harness = await quietRound(port);
        expect((await publish(harness, QUIET)).outcome).toBe("advance");
        const before = port.calls.length;
        expect((await publish(harness, QUIET)).outcome).toBe("advance");
        expect(posts(port.calls.slice(before))).toEqual([]);
        expect(port.calls.some((call) => ["ready", "state"].includes(call))).toBe(false);
    });
});

describe("runPublish: the receipt records a quiet round", () => {
    it("Resolution not read back: no receipt is written and the mode fails", async () => {
        const entry = reportedBy("greptile", { id: "g1", thread: "G1" });
        const port = fakePort({
            threads: [
                botThread("G1", GREPTILE, [
                    "**P1** The loop never stops.",
                    replyOf(EXTERNAL, entry),
                ]),
            ],
            sticky: false,
        });
        const harness = await quietRound(port);
        const report = await publish(harness, QUIET);
        expect(report.outcome).toBe("not-evaluable");
        expect(report.reasons.join("\n")).toContain(`the thread ${PR_URL}#discussion-G1-0 is open`);
        expect(report.receipt).toBeNull();
        expect(existsSync(join(harness.dir, PUBLISH_RECEIPT_FILE))).toBe(false);
    });

    it("refuses the receipt when a dismissal reads back undismissed", async () => {
        const port = fakePort({
            threads: [],
            reviews: [changesRequested("R9", "coderabbitai[bot]")],
            sticky: false,
        });
        const harness = await quietRound(port);
        const report = await publish(harness, QUIET);
        expect(report.reasons.join("\n")).toContain("the review R9 is CHANGES_REQUESTED");
        expect(report.receipt).toBeNull();
    });

    it("marks the receipt of a quiet round quiet, and only that one", async () => {
        const quiet = await quietRound(fakePort());
        expect((await publish(quiet, QUIET)).outcome).toBe("advance");
        const marked = JSON.parse(
            readFileSync(join(quiet.dir, PUBLISH_RECEIPT_FILE), "utf8"),
        ) as Parameters<typeof isQuietReceipt>[0];
        expect(marked.quiet).toBe(true);
        expect(isQuietReceipt(marked)).toBe(true);
        const round = await setup({ id: EXTERNAL, entries: [] });
        expect((await publish(round, EXTERNAL)).outcome).toBe("advance");
        const plain = JSON.parse(
            readFileSync(join(round.dir, PUBLISH_RECEIPT_FILE), "utf8"),
        ) as Parameters<typeof isQuietReceipt>[0];
        expect("quiet" in plain).toBe(false);
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
