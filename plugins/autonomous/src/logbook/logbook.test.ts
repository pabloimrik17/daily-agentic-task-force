import { existsSync, readFileSync, rmSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { type AttemptId, type AttemptRecord } from "../attempts/record.ts";
import {
    attemptDir,
    logbookEntryPath,
    logbookLockPath,
    logbookReceiptPath,
    transitionedPath,
    writeRecord,
} from "../attempts/state.ts";
import { record as startedAttempt, tempState } from "../attempts/test-fixtures.ts";
import { config, task, trackers } from "../label-triage/test-fixtures.ts";
import type { TrackerTask } from "../label-triage/trackers/tracker.ts";
import type { PullRequest, PullRequests } from "../pull-request/port.ts";
import { READ_BACK_DELAYS_MS, READ_BACK_TRIES } from "../read-back.ts";
import { exitCodeFor } from "../report.ts";
import type { Result } from "../result.ts";
import { writeTransitioned } from "../transition/transitioned.ts";
import { checkBody, MAX_WORDS } from "./body.ts";
import { type LogDeps, runLog } from "./logbook.ts";
import { LOGGED_SCHEMA, logbookMarker } from "./marker.ts";
import { LOG_SCHEMA, renderLogJson, renderLogText, unconfiguredLog } from "./report.ts";

const STARTED = new Date("2026-11-13T10:40:30.000Z");
const HOME = "/Users/someone";
const ID = "linear:DOT-121:grill-me:1" as AttemptId;
const BRANCH = "feature/DOT-121-fix-the-login";
const WORKTREE = "/w/dotfiles-worktrees/feature-DOT-121-fix-the-login";
const TASK = { source: "linear", id: "DOT-121", title: "Fix the login" } as const;
const OPEN: PullRequest = {
    number: 42,
    url: "https://github.com/owner/repo/pull/42",
    title: "fix(auth): stop the login loop (DOT-121)",
};

const BODY = [
    "### What I did",
    "Grilled the task and fixed the glossary.",
    "",
    "### Decisions",
    "none",
    "",
    "### Assumptions",
    "none",
    "",
    "### Next stage",
    "Proposal.",
].join("\n");

const BODY_WORDS = checkBody(BODY, HOME).words;

const STATES: string[] = [];
afterAll(() => {
    for (const dir of STATES) {
        rmSync(dir, { recursive: true, force: true });
    }
});

function grillAttempt(overrides: Partial<AttemptRecord> = {}): AttemptRecord {
    const base = startedAttempt();
    return startedAttempt({
        id: ID,
        task: TASK,
        stage: "grill-me",
        history: [
            { state: "pending", at: "2026-11-13T10:01:50.000Z" },
            { state: "created", at: "2026-11-13T10:01:55.000Z" },
            { state: "started", at: "2026-11-13T10:02:00.000Z" },
        ],
        workspace: { ...base.workspace, branch: BRANCH, path: WORKTREE },
        agentArgs: ["--model", "opus", "--effort", "high"],
        ...overrides,
    });
}

interface PortScript {
    open?: PullRequest | null;
    comments?: string[];
    commits?: string[];
    lag?: number; // reads after a comment that do not show it yet; Infinity never shows it
    failures?: Partial<Record<keyof PullRequests, string>>;
}

interface FakePort {
    port: PullRequests;
    directories: string[];
    calls: string[];
    comments: () => readonly string[];
}

function fakePort(script: PortScript = {}): FakePort {
    const calls: string[] = [];
    const stored = [...(script.comments ?? [])];
    let lag = { reads: 0, shows: [...stored] };
    const act = <T>(method: keyof PullRequests, args: unknown[], work: () => T) => {
        calls.push([method, ...args.map(String)].join(" "));
        const error = script.failures?.[method];
        const result: Result<T> =
            error === undefined ? { ok: true, value: work() } : { ok: false, error };
        return Promise.resolve(result);
    };
    const refuse = (method: keyof PullRequests) => () =>
        act(method, [], () => {
            throw new Error(`${method} was not expected`);
        });
    const port: PullRequests = {
        defaultBranch: () => act("defaultBranch", [], () => "main"),
        find: (branch) =>
            act("find", [branch], () => (script.open === undefined ? OPEN : script.open)),
        ahead: refuse("ahead"),
        commitsSince: (base, since) =>
            act("commitsSince", [base, since], () => script.commits ?? []),
        emptyCommit: refuse("emptyCommit"),
        push: refuse("push"),
        open: refuse("open"),
        edit: refuse("edit"),
        comment: (number, file) =>
            act("comment", [number, file], () => {
                lag = { reads: script.lag ?? 0, shows: [...stored] };
                stored.push(readFileSync(file, "utf8"));
            }),
        comments: (number) =>
            act("comments", [number], () => {
                if (lag.reads <= 0) {
                    return [...stored];
                }
                lag.reads -= 1;
                return [...lag.shows];
            }),
    };
    return { port, directories: [], calls, comments: () => stored };
}

interface Arrangement {
    record?: AttemptRecord;
    body?: string | null;
    answer?: string[] | "malformed";
    by?: "agent" | "human";
    labels?: string[];
    readError?: string;
    port?: PortScript;
}

async function arrange(options: Arrangement = {}) {
    const state = tempState();
    STATES.push(state);
    const attempt = options.record ?? grillAttempt();
    await writeRecord(state, attempt);
    const dir = attemptDir(state, attempt.id);
    if (options.body !== null) {
        await writeFile(logbookEntryPath(dir), options.body ?? BODY);
    }
    if (options.answer === "malformed") {
        await writeFile(transitionedPath(dir), "{");
    } else if (options.answer !== undefined) {
        await writeTransitioned(
            dir,
            options.answer,
            new Date("2026-11-13T10:38:00.000Z"),
            options.by,
        );
    }
    const calls: string[] = [];
    const listed: TrackerTask[] = [
        task("linear", "DOT-121", options.labels ?? ["proposal", "HITL"], {
            title: "Fix the login",
        }),
    ];
    const readErrors: Record<string, string> =
        options.readError === undefined ? {} : { "DOT-121": options.readError };
    const fake = fakePort(options.port);
    const waits: number[] = [];
    const deps: LogDeps = {
        config: config(),
        state,
        trackers: trackers(calls, { linear: listed }, { linear: { readErrors } }),
        pullRequests: (directory) => {
            fake.directories.push(directory);
            return fake.port;
        },
        home: HOME,
        wait: (ms) => {
            waits.push(ms);
            return Promise.resolve();
        },
    };
    return { dir, fake, waits, run: (id: AttemptId = attempt.id) => runLog(id, deps, STARTED) };
}

const readJson = (file: string) => JSON.parse(readFileSync(file, "utf8")) as unknown;

const factsOf = (comments: readonly string[]) => comments[0]?.split("\n")[3];

describe("log: one publication per attempt at a time", () => {
    it("publishes nothing while another publication holds the attempt's lock", async () => {
        const { run, fake, dir } = await arrange();
        const lock = logbookLockPath(dir);
        await writeFile(lock, JSON.stringify({ pid: process.pid, startedAt: "t" }));

        const report = await run();

        expect(report.outcome).toBe("not-evaluable");
        expect(report.reasons).toEqual([
            `another run holds ${lock} (pid ${process.pid}, started t)`,
        ]);
        expect(fake.calls).toEqual([`find ${BRANCH}`]);
        expect(fake.comments()).toEqual([]);
    });

    it("releases the lock when it ends, published or failed", async () => {
        const published = await arrange();
        await published.run();
        expect(existsSync(logbookLockPath(published.dir))).toBe(false);

        const failed = await arrange({ port: { failures: { comment: "gh pr comment failed" } } });
        expect((await failed.run()).reasons).toEqual(["gh pr comment failed"]);
        expect(existsSync(logbookLockPath(failed.dir))).toBe(false);
    });
});

describe("log: A logbook entry per attempt", () => {
    it("Entry published: one comment on the pull request holds the header and the body", async () => {
        const { run, fake, dir } = await arrange({
            answer: ["HITL"],
            port: { commits: ["a1b2c3d"] },
        });
        const report = await run();
        expect(report.outcome).toBe("advance");
        expect(report.entry).toBe("published");
        expect(fake.directories).toEqual([WORKTREE]);
        expect(fake.comments()).toHaveLength(1);
        const [entry = ""] = fake.comments();
        expect(entry.startsWith(`${logbookMarker(ID)}\n### 🔥 grill-me · attempt 1\n\n`)).toBe(
            true,
        );
        expect(entry.endsWith(`\n\n${BODY}\n`)).toBe(true);
        expect(readFileSync(join(dir, "logbook-comment.md"), "utf8")).toBe(entry);
        expect(fake.calls).toEqual([
            `find ${BRANCH}`,
            "comments 42",
            "defaultBranch",
            "commitsSince main 2026-11-13T10:02:00.000Z",
            `comment 42 ${join(dir, "logbook-comment.md")}`,
            "comments 42",
        ]);
    });

    it("Mode run twice: no second comment is added and the exit code is 0", async () => {
        const { run, fake, dir } = await arrange();
        expect((await run()).outcome).toBe("advance");
        rmSync(logbookReceiptPath(dir));
        const again = await run();
        expect(fake.comments()).toHaveLength(1);
        expect(again).toMatchObject({
            outcome: "advance",
            entry: "existing",
            receipt: logbookReceiptPath(dir),
            reasons: [],
            task: TASK,
        });
        expect(exitCodeFor(again.outcome)).toBe(0);
        expect(existsSync(logbookReceiptPath(dir))).toBe(true);
        expect(fake.calls.slice(-2)).toEqual([`find ${BRANCH}`, "comments 42"]);
    });

    it("an entry already there with its receipt leaves the receipt as it is", async () => {
        const { run, fake, dir } = await arrange();
        await run();
        const receipt = readFileSync(logbookReceiptPath(dir), "utf8");
        const again = await run();
        expect(again).toMatchObject({ outcome: "advance", entry: "existing" });
        expect(fake.comments()).toHaveLength(1);
        expect(readFileSync(logbookReceiptPath(dir), "utf8")).toBe(receipt);
    });

    it("No pull request: nothing is published, the report says so and the exit code is 3", async () => {
        const { run, fake, dir } = await arrange({ port: { open: null } });
        const report = await run();
        expect(report.outcome).toBe("not-evaluable");
        expect(exitCodeFor(report.outcome)).toBe(3);
        expect(report.pullRequest).toBeNull();
        expect(report.task).toEqual(TASK);
        expect(report.reasons).toEqual([
            `no open pull request for branch ${BRANCH}: run --pull-request <attempt> first`,
        ]);
        expect(fake.calls).toEqual([`find ${BRANCH}`]);
        expect(existsSync(logbookReceiptPath(dir))).toBe(false);
    });
});

describe("log: Logbook entry body", () => {
    it("Section missing: nothing is published and the report names the section", async () => {
        const body = BODY.replace("### Assumptions\nnone\n\n", "");
        const { run, fake } = await arrange({ body });
        const report = await run();
        expect(report.outcome).toBe("not-evaluable");
        expect(report.reasons).toEqual(['the section "### Assumptions" is missing']);
        expect(fake.calls).toEqual([]);
        expect(fake.directories).toEqual([]);
    });

    it("Body too long: nothing is published and the report gives the count and the limit", async () => {
        const padding = Array.from({ length: 340 - BODY_WORDS }, () => "word").join(" ");
        const { run, fake } = await arrange({ body: `${BODY}\n${padding}` });
        const report = await run();
        expect(report.words).toBe(340);
        expect(report.reasons).toEqual([`the body has 340 words, over the limit of ${MAX_WORDS}`]);
        expect(fake.calls).toEqual([]);
    });

    it("Machine detail: a path under the home directory is rejected by its rule", async () => {
        const body = BODY.replace("none", `Edited ${HOME}/notes.md`);
        const { run, fake } = await arrange({ body });
        const report = await run();
        expect(report.reasons).toEqual(["the body names this machine's home directory"]);
        expect(fake.calls).toEqual([]);
    });

    it("Stage section: a further section is published with the entry", async () => {
        const body = `${BODY}\n\n### Proposal\nThe change is proposed.`;
        const { run, fake } = await arrange({ body });
        expect((await run()).outcome).toBe("advance");
        expect(fake.comments()[0]).toContain("### Proposal\nThe change is proposed.\n");
    });
});

describe("log: Logbook entry header", () => {
    it("Grill with an answered autonomy: the header holds every fact", async () => {
        const { run, fake } = await arrange({ answer: ["HITL"], port: { commits: ["a1b2c3d"] } });
        await run();
        expect(fake.comments()[0]?.split("\n").slice(0, 4)).toEqual([
            logbookMarker(ID),
            "### 🔥 grill-me · attempt 1",
            "",
            "`HITL` · `--model opus --effort high` · 2026-11-13 10:02 → 10:40 UTC (38 min) · answered `HITL` · 1 commit (`a1b2c3d`)",
        ]);
    });

    it("a transition the agent made: the header says no one answered", async () => {
        const { run, fake } = await arrange({ answer: ["implement"], by: "agent" });
        await run();
        const facts = factsOf(fake.comments());
        expect(facts).toContain("moved to `implement` by the agent, with no answer");
        expect(facts).not.toContain("answered");
    });

    it("a transition a human answered: the header says answered", async () => {
        const { run, fake } = await arrange({ answer: ["implement"], by: "human" });
        await run();
        expect(factsOf(fake.comments())).toContain("answered `implement`");
    });

    it("a transition record without by: the header says answered", async () => {
        const { run, fake } = await arrange({ answer: ["HITL"] });
        await run();
        expect(factsOf(fake.comments())).toContain("answered `HITL`");
    });

    it("Record from before this capability: the entry is published without agent arguments", async () => {
        const { run, fake } = await arrange({ record: grillAttempt({ agentArgs: null }) });
        expect((await run()).outcome).toBe("advance");
        expect(factsOf(fake.comments())).toBe(
            "`HITL` · 2026-11-13 10:02 → 10:40 UTC (38 min) · no commits",
        );
    });

    it("No commits: the header says so", async () => {
        const { run, fake } = await arrange();
        await run();
        expect(factsOf(fake.comments())).toMatch(/ · no commits$/);
    });

    it("a task without an autonomy label and a record never started leave both out", async () => {
        const never = grillAttempt({
            state: "created",
            history: [{ state: "pending", at: "2026-11-13T10:01:50.000Z" }],
        });
        const { run, fake } = await arrange({ record: never, labels: ["grill-me"] });
        expect((await run()).outcome).toBe("advance");
        expect(factsOf(fake.comments())).toBe(
            "`--model opus --effort high` · ended 2026-11-13 10:40 UTC · no commits",
        );
        expect(fake.calls).not.toContain("defaultBranch");
    });

    it("a malformed transition.json is a note, and the entry goes out without the answer", async () => {
        const { run, fake, dir } = await arrange({ answer: "malformed" });
        const report = await run();
        expect(report.outcome).toBe("advance");
        expect(report.notes).toHaveLength(1);
        expect(report.notes[0]).toContain(transitionedPath(dir));
        expect(factsOf(fake.comments())).not.toContain("answered");
    });

    it("a failed task read publishes nothing and names the command", async () => {
        const error = "linear issue view DOT-121: boom";
        const { run, fake } = await arrange({ readError: error });
        const report = await run();
        expect(report.reasons).toEqual([error]);
        expect(fake.comments()).toEqual([]);
    });

    it("a failed commit listing publishes nothing and names the command", async () => {
        const error = "git log --since=2026-11-13T10:02:00.000Z: boom";
        const { run, fake } = await arrange({ port: { failures: { commitsSince: error } } });
        const report = await run();
        expect(report.reasons).toEqual([error]);
        expect(fake.comments()).toEqual([]);
    });
});

describe("log: The entry is read back and leaves a receipt", () => {
    it("Receipt written: the receipt names the attempt, the pull request and the time", async () => {
        const { run, dir } = await arrange();
        const report = await run();
        expect(report.receipt).toBe(logbookReceiptPath(dir));
        expect(readJson(logbookReceiptPath(dir))).toEqual({
            schema: LOGGED_SCHEMA,
            attempt: ID,
            pullRequest: { number: 42, url: OPEN.url },
            at: STARTED.toISOString(),
        });
    });

    it("a read that lags the comment is waited out", async () => {
        const { run, waits } = await arrange({ port: { lag: 2 } });
        const report = await run();
        expect(report.outcome).toBe("advance");
        expect(waits).toEqual(READ_BACK_DELAYS_MS.slice(0, 2));
    });

    it("Comment not found on read-back: no receipt is written and the exit code is 3", async () => {
        const { run, dir, waits } = await arrange({ port: { lag: Infinity } });
        const report = await run();
        expect(report).toMatchObject({
            outcome: "not-evaluable",
            entry: "published",
            receipt: null,
        });
        expect(report.reasons).toEqual([
            `pull request #42: no comment starting with ${logbookMarker(ID)} was found when read back (${READ_BACK_TRIES})`,
        ]);
        expect(waits).toEqual(READ_BACK_DELAYS_MS);
        expect(existsSync(logbookReceiptPath(dir))).toBe(false);
    });

    it("a failed comment leaves no receipt and names the command", async () => {
        const error = "gh pr comment 42 --body-file logbook-comment.md: boom";
        const { run, dir } = await arrange({ port: { failures: { comment: error } } });
        const report = await run();
        expect(report).toMatchObject({ entry: "none", reasons: [error], receipt: null });
        expect(existsSync(logbookReceiptPath(dir))).toBe(false);
    });
});

describe("log: Log mode", () => {
    it("Body file missing: nothing is published and the report names the file", async () => {
        const { run, fake, dir } = await arrange({ body: null });
        const report = await run();
        expect(report.outcome).toBe("not-evaluable");
        expect(report.reasons).toEqual([`${logbookEntryPath(dir)} is missing`]);
        expect(report.reasons[0]).toContain("logbook-entry.md");
        expect(report.task).toEqual(TASK);
        expect(fake.calls).toEqual([]);
    });

    it("a blank body file is reported as empty", async () => {
        const { run, dir } = await arrange({ body: "  \n" });
        expect((await run()).reasons).toEqual([`${logbookEntryPath(dir)} is empty`]);
    });

    it("an unknown attempt leaves the task unread", async () => {
        const { run, fake } = await arrange();
        const report = await run("linear:DOT-999:grill-me:1");
        expect(report.outcome).toBe("not-evaluable");
        expect(report.task).toBeNull();
        expect(fake.calls).toEqual([]);
    });

    it("a rejected body still reports the task", async () => {
        const { run, fake } = await arrange({ body: "no sections" });
        const report = await run();
        expect(report.outcome).toBe("not-evaluable");
        expect(report.task).toEqual(TASK);
        expect(fake.calls).toEqual([]);
    });

    it("a completed attempt calls nothing on the port", async () => {
        const { run, fake } = await arrange({ record: grillAttempt({ state: "completed" }) });
        const report = await run();
        expect(report.reasons).toEqual([`attempt ${ID} is completed, not open`]);
        expect(fake.directories).toEqual([]);
        expect(fake.calls).toEqual([]);
    });
});

describe("log: Log report", () => {
    it("Log JSON report: one document with the schema, the word count, the limit and no receipt", async () => {
        const padding = Array.from({ length: 340 - BODY_WORDS }, () => "word").join(" ");
        const { run } = await arrange({ body: `${BODY}\n${padding}` });
        const json = renderLogJson(await run());
        const document = JSON.parse(json) as Record<string, unknown>;
        expect(document).toMatchObject({
            schema: LOG_SCHEMA,
            startedAt: STARTED.toISOString(),
            outcome: "not-evaluable",
            attempt: ID,
            words: 340,
            receipt: null,
        });
        expect(document.reasons).toEqual([expect.stringContaining(`limit of ${MAX_WORDS}`)]);
        expect(LOG_SCHEMA).toBe("autonomous.log.v1");
    });

    it("the text report gives the same information", async () => {
        const { run, dir } = await arrange();
        const text = renderLogText(await run());
        expect(text.split("\n")).toEqual([
            `autonomous log — started ${STARTED.toISOString()}`,
            "outcome: advance",
            `attempt: ${ID}`,
            'task: linear DOT-121 → "Fix the login"',
            `pull request: #42 ${OPEN.url}`,
            `body: ${BODY_WORDS} words`,
            "entry: published",
            `receipt: ${logbookReceiptPath(dir)}`,
        ]);
    });

    it("the text report lists the reasons", async () => {
        const { run } = await arrange({ port: { open: null } });
        const text = renderLogText(await run());
        expect(text).toContain("entry: not published");
        expect(text).toContain("receipt: none");
        expect(text).toContain(`reasons:\n  - no open pull request for branch ${BRANCH}`);
    });

    it("an unloadable configuration still yields one document, and a short text report", () => {
        const report = unconfiguredLog(ID, "/c.json", "bad", STARTED);
        expect(JSON.parse(renderLogJson(report))).toMatchObject({
            schema: LOG_SCHEMA,
            config: { path: "/c.json", error: "bad" },
        });
        expect(renderLogText(report).split("\n")).toHaveLength(3);
    });
});
