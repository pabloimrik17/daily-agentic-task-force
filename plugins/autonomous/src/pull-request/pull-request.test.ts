import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import type { AttemptId, AttemptState } from "../attempts/record.ts";
import { attemptDir, recordPath, writeRecord } from "../attempts/state.ts";
import { record, tempState } from "../attempts/test-fixtures.ts";
import { config } from "../label-triage/test-fixtures.ts";
import { exitCodeFor } from "../report.ts";
import type { Result } from "../result.ts";
import { fakeReader, workTask } from "../select/test-fixtures.ts";
import type { WorkTask } from "../select/types.ts";
import { cover } from "./cover.ts";
import { runPullRequest } from "./mode.ts";
import type { PullRequest, PullRequests } from "./port.ts";
import {
    PULL_REQUEST_SCHEMA,
    renderPullRequestJson,
    renderPullRequestText,
    unconfiguredPullRequest,
} from "./report.ts";

const STARTED = new Date("2026-11-13T10:40:00.000Z");
const ID: AttemptId = "linear:DOT-121:grill-me:1";
const BRANCH = "feature/DOT-121-read-github-blockers";
const WORKTREE = "/w/dotfiles-worktrees/feature-DOT-121-read-github-blockers";
const URL = "https://github.com/owner/repo/pull/7";
const TITLE = "feat(autonomous): read GitHub blockers";
const TITLED = "feat(autonomous): read GitHub blockers (DOT-121)";
const NO_TITLE = "a title is required to open the pull request: pass --title";

const DEFINITION = [
    "## Definition",
    "",
    "### Problem",
    "",
    "GitHub blockers are not read.",
    "",
    "### Solution",
    "",
    "Read them from the issue's dependencies.",
    "",
].join("\n");

const STATES: string[] = [];
afterAll(() => {
    for (const dir of STATES) {
        rmSync(dir, { recursive: true, force: true });
    }
});

type Method = keyof PullRequests;

interface PortScript {
    base?: string;
    found?: PullRequest | null;
    ahead?: number;
    failures?: Partial<Record<Method, string>>;
}

interface FakePort {
    factory: (directory: string) => PullRequests;
    directories: string[];
    calls: string[];
    bodies: string[];
    script: PortScript; // mutable, so a second run sees what the first one did
}

function show(argument: unknown): string {
    return typeof argument === "string" ? argument : JSON.stringify(argument);
}

function fakePort(script: PortScript = {}): FakePort {
    const calls: string[] = [];
    const bodies: string[] = [];
    const directories: string[] = [];
    const act = <T>(method: Method, args: unknown[], work: () => T): Promise<Result<T>> => {
        calls.push([method, ...args.map(show)].join(" "));
        const error = script.failures?.[method];
        return Promise.resolve(
            error === undefined ? { ok: true, value: work() } : { ok: false, error },
        );
    };
    const keepBody = (file: string) => bodies.push(readFileSync(file, "utf8"));
    const methods: PullRequests = {
        defaultBranch: () => act("defaultBranch", [], () => script.base ?? "main"),
        find: (branch) => act("find", [branch], () => script.found ?? null),
        ahead: (base) => act("ahead", [base], () => script.ahead ?? 1),
        commitsSince: (base, since) => act("commitsSince", [base, since], () => []),
        emptyCommit: (message) =>
            act("emptyCommit", [message], () => {
                script.ahead = (script.ahead ?? 0) + 1;
            }),
        push: (branch) => act("push", [branch], () => undefined),
        open: (request: Parameters<PullRequests["open"]>[0]) =>
            act("open", [request], () => {
                keepBody(request.bodyFile);
                const opened = { number: 7, url: URL, title: request.title };
                script.found = opened;
                return opened;
            }),
        edit: (number, change) =>
            act("edit", [number, change], () => {
                keepBody(change.bodyFile);
            }),
        comment: (number, file) => act("comment", [number, file], () => undefined),
        comments: (number) => act("comments", [number], () => []),
        threads: (number) => act("threads", [number], () => []),
        pendingReview: (number) => act("pendingReview", [number], () => null),
        review: (number, body, threads) =>
            act("review", [number, body, threads], () => ({ id: "R_1", url: URL })),
        reply: (thread, body) => act("reply", [thread, body], () => undefined),
        resolve: (thread) => act("resolve", [thread], () => undefined),
        unresolve: (thread) => act("unresolve", [thread], () => undefined),
        state: (number) =>
            act("state", [number], () => ({
                draft: false,
                head: { sha: "0ddba11", committedAt: "2026-01-01T00:00:00Z" },
                readyAt: null,
            })),
        ready: (number) => act("ready", [number], () => undefined),
        checkRuns: (sha) => act("checkRuns", [sha], () => []),
        reviews: (number) => act("reviews", [number], () => []),
        dismiss: (number, review, message) =>
            act("dismiss", [number, review, message], () => undefined),
    };
    const factory = (directory: string) => {
        directories.push(directory);
        return methods;
    };
    return { factory, directories, calls, bodies, script };
}

interface Arrange {
    status?: AttemptState;
    task?: Partial<WorkTask>;
    detail?: Partial<WorkTask>;
    port?: PortScript;
    listed?: boolean;
}

async function arrange(options: Arrange = {}) {
    const state = tempState();
    STATES.push(state);
    await writeRecord(
        state,
        record({
            id: ID,
            task: { source: "linear", id: "DOT-121", title: "Read GitHub blockers" },
            stage: "grill-me",
            state: options.status ?? "started",
            workspace: {
                manager: "worktrunk",
                repository: "/w/dotfiles",
                inferredFrom: "project Dotfiles",
                branch: BRANCH,
                path: WORKTREE,
            },
        }),
    );
    const task = workTask("linear", "DOT-121", ["personal", "grill-me"], {
        title: "Read GitHub blockers",
        description: DEFINITION,
        children: null,
        ...options.task,
    });
    const reads: string[] = [];
    const detail = {
        url: "https://linear.app/team/issue/DOT-121",
        parent: null,
        children: [],
        ...options.detail,
    };
    const reader = fakeReader("linear", options.listed === false ? [] : [task], reads, {
        details: { "DOT-121": detail },
    });
    const port = fakePort(options.port);
    const deps = { config: config(), state, work: [reader], pullRequests: port.factory };
    const dir = attemptDir(state, ID);
    return {
        dir,
        state,
        port,
        reads,
        deps,
        coverOf: () => cover({ ...task, ...detail }, detail.parent ?? null),
        run: (title = TITLE) => runPullRequest(ID, title, deps, STARTED),
        untitled: () => runPullRequest(ID, undefined, deps, STARTED),
    };
}

const OPEN_REQUEST = (dir: string, title = TITLED) =>
    `open ${JSON.stringify({ base: "main", branch: BRANCH, title, bodyFile: join(dir, "cover.md") })}`;

describe("pull-request: One pull request per workspace branch", () => {
    it("First stage to finish: the branch is pushed and a draft is opened against the default branch", async () => {
        const { run, port, dir } = await arrange({ port: { ahead: 1 } });
        const report = await run();
        expect(port.directories).toEqual([WORKTREE]);
        expect(port.calls).toEqual([
            "defaultBranch",
            `find ${BRANCH}`,
            "ahead main",
            `push ${BRANCH}`,
            OPEN_REQUEST(dir),
        ]);
        expect(report.outcome).toBe("advance");
        expect(exitCodeFor(report.outcome)).toBe(0);
        expect(report.emptyCommit).toBe(false);
        expect(report.base).toBe("main");
        expect(report.branch).toBe(BRANCH);
        expect(report.pullRequest).toEqual({
            number: 7,
            url: URL,
            title: TITLED,
            action: "opened",
        });
    });

    it("Pull request already open: it is reused, none is opened, and the cover is rewritten", async () => {
        const found = { number: 12, url: URL, title: TITLED };
        const { untitled, port, dir, coverOf } = await arrange({ port: { found } });
        const report = await untitled();
        expect(port.calls).toEqual([
            "defaultBranch",
            `find ${BRANCH}`,
            `edit 12 ${JSON.stringify({ bodyFile: join(dir, "cover.md") })}`,
        ]);
        expect(port.bodies).toEqual([coverOf()]);
        expect(report.outcome).toBe("advance");
        expect(report.pullRequest).toEqual({ ...found, action: "reused" });
    });

    it("Push rejected: no pull request is opened and the report names the failed command", async () => {
        const error = `git push -u origin ${BRANCH}: exit 1: pre-push hook failed`;
        const { run, port } = await arrange({ port: { failures: { push: error } } });
        const report = await run();
        expect(port.calls.some((call) => call.startsWith("open"))).toBe(false);
        expect(report.reasons).toEqual([error]);
        expect(report.pullRequest).toBeNull();
        expect(report.outcome).toBe("not-evaluable");
        expect(exitCodeFor(report.outcome)).toBe(3);
    });

    it("a run after a push that went through and an open that failed pushes again and opens", async () => {
        const error = "gh pr create --draft: exit 1: HTTP 502";
        const { run, port, dir } = await arrange({ port: { ahead: 0, failures: { open: error } } });
        const first = await run();
        expect(first.reasons).toEqual([error]);
        expect(first.emptyCommit).toBe(true);
        port.script.failures = {};
        port.calls.length = 0;
        const second = await run();
        expect(port.calls).toEqual([
            "defaultBranch",
            `find ${BRANCH}`,
            "ahead main",
            `push ${BRANCH}`,
            OPEN_REQUEST(dir),
        ]);
        expect(second.emptyCommit).toBe(false);
        expect(second.outcome).toBe("advance");
    });

    it("an error of the lookup stops the mode before anything is pushed", async () => {
        const error = "gh pr list --head feature/x: exit 4: not logged in";
        const { run, port } = await arrange({ port: { failures: { find: error } } });
        const report = await run();
        expect(port.calls).toEqual(["defaultBranch", `find ${BRANCH}`]);
        expect(report.reasons).toEqual([error]);
        expect(report.outcome).toBe("not-evaluable");
    });
});

describe("pull-request: A branch with nothing to show", () => {
    it("Grill without documentation changes: an empty commit is added, then the push and the draft", async () => {
        const { run, port, dir } = await arrange({ port: { ahead: 0 } });
        const report = await run();
        expect(port.calls).toEqual([
            "defaultBranch",
            `find ${BRANCH}`,
            "ahead main",
            "emptyCommit chore: open the pull request of DOT-121",
            `push ${BRANCH}`,
            OPEN_REQUEST(dir),
        ]);
        expect(report.emptyCommit).toBe(true);
        expect(report.outcome).toBe("advance");
    });

    it("Parent of a split without commits: no commit, no push, no pull request, exit 0 with the reason", async () => {
        const { run, port, dir } = await arrange({
            port: { ahead: 0 },
            detail: { children: ["DOT-130", "DOT-131"] },
        });
        const report = await run();
        expect(port.calls).toEqual(["defaultBranch", `find ${BRANCH}`, "ahead main"]);
        expect(existsSync(join(dir, "cover.md"))).toBe(false);
        expect(report.outcome).toBe("advance");
        expect(exitCodeFor(report.outcome)).toBe(0);
        expect(report.needed).toBe(false);
        expect(report.pullRequest).toBeNull();
        expect(report.emptyCommit).toBe(false);
        expect(report.reasons).toEqual([
            `linear:DOT-121 is the parent of a split with nothing to show: its subtasks DOT-130, DOT-131 are open and ${BRANCH} has no commit ahead of main`,
        ]);
    });

    it("a parent of a split without commits needs no title: nothing is committed or pushed, exit 0", async () => {
        const { untitled, port } = await arrange({
            port: { ahead: 0 },
            detail: { children: ["DOT-130", "DOT-131"] },
        });
        const report = await untitled();
        expect(port.calls).toEqual(["defaultBranch", `find ${BRANCH}`, "ahead main"]);
        expect(report.needed).toBe(false);
        expect(report.emptyCommit).toBe(false);
        expect(report.pullRequest).toBeNull();
        expect(report.outcome).toBe("advance");
        expect(report.reasons).not.toContain(NO_TITLE);
    });

    it("Parent of a split with documentation commits: the draft is opened as for any task", async () => {
        const { run, port, dir } = await arrange({
            port: { ahead: 1 },
            detail: { children: ["DOT-130", "DOT-131"] },
        });
        const report = await run();
        expect(port.calls.at(-1)).toBe(OPEN_REQUEST(dir));
        expect(report.needed).toBe(true);
        expect(report.pullRequest?.action).toBe("opened");
    });
});

describe("pull-request: Pull request title", () => {
    it("Title with the task id: the text is followed by the id", async () => {
        const { run } = await arrange();
        expect((await run(TITLE)).pullRequest?.title).toBe(TITLED);
    });

    it("a title that already ends with the task id is unchanged", async () => {
        const { run, port, dir } = await arrange();
        await run(TITLED);
        expect(port.calls.at(-1)).toBe(OPEN_REQUEST(dir, TITLED));
    });

    it("No title and no pull request: nothing is committed, pushed or opened, and the reason names the title", async () => {
        const { untitled, port } = await arrange({ port: { ahead: 0 } });
        const report = await untitled();
        expect(port.calls).toEqual(["defaultBranch", `find ${BRANCH}`, "ahead main"]);
        expect(report.emptyCommit).toBe(false);
        expect(report.reasons).toEqual([NO_TITLE]);
        expect(report.outcome).toBe("not-evaluable");
        expect(exitCodeFor(report.outcome)).toBe(3);
    });

    it("Title corrected by a later stage: the open pull request is retitled", async () => {
        const found = { number: 12, url: URL, title: TITLED };
        const { run, port, dir } = await arrange({ port: { found } });
        const report = await run("fix(autonomous): read GitHub blockers");
        const title = "fix(autonomous): read GitHub blockers (DOT-121)";
        expect(port.calls.at(-1)).toBe(
            `edit 12 ${JSON.stringify({ title, bodyFile: join(dir, "cover.md") })}`,
        );
        expect(report.pullRequest).toEqual({ number: 12, url: URL, title, action: "reused" });
    });
});

describe("pull-request: The cover", () => {
    it("the draft's description is the cover of the task as detail read it", async () => {
        const parent = { id: "DOT-100", url: "https://linear.app/team/issue/DOT-100" };
        const { run, port, dir, coverOf } = await arrange({ detail: { parent } });
        await run();
        expect(port.bodies).toEqual([coverOf()]);
        expect(port.bodies[0]).toContain("Parent: [DOT-100]");
        expect(readFileSync(join(dir, "cover.md"), "utf8")).toBe(coverOf());
    });

    it("Cover refreshed: a later run writes the definition the task holds now", async () => {
        const first = await arrange();
        await first.run();
        const changed = DEFINITION.replace("Read them", "Read them, cached,");
        const second = await arrange({
            task: { description: changed },
            port: { found: first.port.script.found ?? null },
        });
        await second.untitled();
        expect(second.port.bodies).toEqual([second.coverOf()]);
        expect(second.port.bodies[0]).toContain(
            "Read them, cached, from the issue's dependencies.",
        );
    });

    it("Cover of a task without a definition: the first paragraph stands in", async () => {
        const description = "The first paragraph.\n\nThe second one.\n\nThe third one.";
        const { run, port } = await arrange({ task: { description } });
        await run();
        expect(port.bodies[0]).toContain("The first paragraph.");
        expect(port.bodies[0]).not.toContain("The second one.");
    });

    it("Task without a description: the cover holds the link only", async () => {
        const { run, port } = await arrange({ task: { description: null } });
        await run();
        expect(port.bodies).toEqual(["Task: [DOT-121](https://linear.app/team/issue/DOT-121)"]);
    });
});

describe("pull-request: preconditions", () => {
    it("Completed attempt: nothing is called on the port and the mode exits 3", async () => {
        const { run, port, reads } = await arrange({ status: "completed" });
        const report = await run();
        expect(port.directories).toEqual([]);
        expect(port.calls).toEqual([]);
        expect(reads).toEqual([]);
        expect(report.reasons).toEqual([`attempt ${ID} is completed, not open`]);
        expect(report.outcome).toBe("not-evaluable");
        expect(exitCodeFor(report.outcome)).toBe(3);
    });

    it("an unknown attempt is refused naming it", async () => {
        const { deps, state, port } = await arrange();
        const unknown = "linear:DOT-999:grill-me:1";
        const report = await runPullRequest(unknown, TITLE, deps, STARTED);
        const file = recordPath(attemptDir(state, unknown));
        expect(report.reasons).toEqual([`unknown attempt ${unknown}: no record at ${file}`]);
        expect(port.calls).toEqual([]);
        expect(report.outcome).toBe("not-evaluable");
    });

    it("a task that is no longer open is refused before the port is made", async () => {
        const { run, port } = await arrange({ listed: false });
        const report = await run();
        expect(report.reasons).toEqual(["linear:DOT-121 is not an open task"]);
        expect(report.task).toBeNull();
        expect(report.branch).toBe(BRANCH);
        expect(port.directories).toEqual([]);
    });

    it("a source with no reader is reported as not enabled", async () => {
        const { deps, port } = await arrange();
        const report = await runPullRequest(ID, TITLE, { ...deps, work: [] }, STARTED);
        expect(report.reasons).toEqual(["linear is not enabled"]);
        expect(port.directories).toEqual([]);
    });
});

describe("pull-request: Pull-request report", () => {
    it("Pull-request JSON report: one document with the schema, the URL and the pull request reused", async () => {
        const found = { number: 12, url: URL, title: TITLED };
        const { untitled } = await arrange({ port: { found } });
        const json = renderPullRequestJson(await untitled());
        expect(JSON.parse(json)).toEqual({
            schema: PULL_REQUEST_SCHEMA,
            startedAt: STARTED.toISOString(),
            outcome: "advance",
            attempt: ID,
            task: { source: "linear", id: "DOT-121", title: "Read GitHub blockers" },
            branch: BRANCH,
            base: "main",
            needed: true,
            pullRequest: { number: 12, url: URL, title: TITLED, action: "reused" },
            emptyCommit: false,
            reasons: [],
        });
        expect(PULL_REQUEST_SCHEMA).toBe("autonomous.pull-request.v1");
    });

    it("the text report gives the task, the branches, the pull request and the empty commit", async () => {
        const { run } = await arrange({ port: { ahead: 0 } });
        expect(renderPullRequestText(await run())).toBe(
            [
                `autonomous pull-request — started ${STARTED.toISOString()}`,
                "outcome: advance",
                `attempt: ${ID}`,
                'task: linear DOT-121 → "Read GitHub blockers"',
                `branch: ${BRANCH}`,
                "base: main",
                `pull request: #7 opened, ${URL}`,
                `title: "${TITLED}"`,
                "empty commit: added",
            ].join("\n"),
        );
    });

    it("the text report of a refusal shows what was not read and lists the reasons", async () => {
        const { untitled } = await arrange();
        expect(renderPullRequestText(await untitled())).toBe(
            [
                `autonomous pull-request — started ${STARTED.toISOString()}`,
                "outcome: not-evaluable",
                `attempt: ${ID}`,
                'task: linear DOT-121 → "Read GitHub blockers"',
                `branch: ${BRANCH}`,
                "base: main",
                "pull request: none",
                "empty commit: none",
                "reasons:",
                `  - ${NO_TITLE}`,
            ].join("\n"),
        );
    });

    it("the text report of a split parent says no pull request is needed", async () => {
        const { run } = await arrange({ port: { ahead: 0 }, detail: { children: ["DOT-130"] } });
        expect(renderPullRequestText(await run())).toContain("pull request: not needed");
    });

    it("a configuration that cannot be loaded is one document with the path and the error", () => {
        const report = unconfiguredPullRequest(
            ID,
            "/home/me/config.json",
            "configuration file not found",
            STARTED,
        );
        expect(JSON.parse(renderPullRequestJson(report))).toEqual({
            schema: PULL_REQUEST_SCHEMA,
            startedAt: STARTED.toISOString(),
            outcome: "not-evaluable",
            attempt: ID,
            task: null,
            branch: null,
            base: null,
            needed: true,
            pullRequest: null,
            emptyCommit: false,
            reasons: [],
            config: { path: "/home/me/config.json", error: "configuration file not found" },
        });
        expect(renderPullRequestText(report)).toBe(
            [
                `autonomous pull-request — started ${STARTED.toISOString()}`,
                "outcome: not-evaluable",
                `attempt: ${ID}`,
            ].join("\n"),
        );
        expect(exitCodeFor(report.outcome)).toBe(3);
    });
});
