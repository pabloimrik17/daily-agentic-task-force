import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Exec, ExecResult } from "../exec.ts";
import { config } from "../label-triage/test-fixtures.ts";
import type { Result } from "../result.ts";
import { temporaryDirectories } from "../stages/test-fixtures.ts";
import { type CliDeps, main, USAGE } from "./cli.ts";
import type { RunContext, Runner } from "./runners/shared.ts";
import {
    FINDING_SCHEMA,
    type Plan,
    REPORT_SCHEMA,
    type Report,
    type ReviewerFile,
} from "./types.ts";

const ROOT = "/work/my-repo";
const MERGE_BASE = "1111111111111111111111111111111111111111";
const HEAD = "2222222222222222222222222222222222222222";
const BRIEFS_DIR = fileURLToPath(new URL("../../skills/review-team/reviewers", import.meta.url));

const directories = temporaryDirectories("review-cli");
let tmp: string;

interface Call {
    command: string;
    args: string[];
    timeoutMs: number;
    cwd: string;
    keepOutputOnExit?: boolean;
}

// The answers of a fake git in a repository whose branch is `numstat` ahead of `origin/main`.
function gitAnswers(numstat: string, failing?: string): [string, ExecResult][] {
    const ok = (stdout: string): ExecResult => ({ ok: true, stdout });
    const answers: [string, ExecResult][] = [
        ["rev-parse --show-toplevel", ok(`${ROOT}\n`)],
        ["symbolic-ref refs/remotes/origin/HEAD", ok("refs/remotes/origin/main\n")],
        ["rev-parse --verify", ok(`${MERGE_BASE}\n`)],
        ["merge-base", ok(`${MERGE_BASE}\n`)],
        ["rev-parse --abbrev-ref HEAD", ok("feature/work\n")],
        ["rev-parse HEAD", ok(`${HEAD}\n`)],
        ["status --porcelain", ok("")],
        ["diff --numstat", ok(numstat)],
        ["diff --name-only", ok("src/a.ts\0")],
        ["-c core.quotePath=false diff", ok("")],
    ];
    return answers.map(([prefix, answer]) =>
        prefix === failing
            ? [prefix, { ok: false, error: `git failed: ${prefix}` }]
            : [prefix, answer],
    );
}

const TOOLS: Record<string, ExecResult> = {
    gh: { ok: false, error: "gh failed: no pull requests found" },
    codex: { ok: true, stdout: "" },
    coderabbit: { ok: true, stdout: '{"authenticated":true}\n' },
    fallow: { ok: true, stdout: "fallow 2.1.0\n" },
    claude: { ok: true, stdout: "2.1.300 (Claude Code)\n" },
    plannotator: { ok: true, stdout: "0.29.2\n" },
};

const SMALL = "10\t0\tsrc/a.ts\0";
const MEDIUM = "200\t0\tsrc/a.ts\0";

interface Harness {
    deps: CliDeps;
    calls: Call[];
    stdout: string[];
    stderr: string[];
    collected: { dir: string; git: Exec; plannotator: Exec }[];
    contexts: RunContext[];
}

function report(errors: string[] = []): Report {
    return {
        schema: REPORT_SCHEMA,
        subject: {
            repo: "my-repo",
            branch: "feature/work",
            base: "main",
            baseSource: "default-branch",
            mergeBase: MERGE_BASE,
            head: HEAD,
            dirty: false,
        },
        measure: { lines: 10, files: 1 },
        tier: { measured: "S", used: "S" },
        security: { triggered: false, matches: [] },
        reviewers: [],
        findings: [],
        doubts: [],
        walkthrough: { guide: null, reason: "no walkthrough" },
        errors,
    };
}

const reported: ReviewerFile = {
    schema: FINDING_SCHEMA,
    reviewer: "coderabbit",
    outcome: "reported",
    durationMs: 5,
    items: [],
};

interface Options {
    numstat?: string;
    failingGit?: string;
    readConfig?: (path: string) => string;
    collected?: Result<Report>;
    file?: ReviewerFile;
    cwd?: string;
}

const missingFile = () => {
    throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
};

function harness(options: Options = {}): Harness {
    const calls: Call[] = [];
    const stdout: string[] = [];
    const stderr: string[] = [];
    const collected: Harness["collected"] = [];
    const contexts: RunContext[] = [];
    const git = gitAnswers(options.numstat ?? SMALL, options.failingGit);
    const runner: Runner = (ctx) => {
        contexts.push(ctx);
        return Promise.resolve(options.file ?? reported);
    };
    const deps: CliDeps = {
        exec:
            (command, timeoutMs, { cwd, keepOutputOnExit }) =>
            (args) => {
                calls.push({ command, args, timeoutMs, cwd, keepOutputOnExit });
                const answer =
                    command === "git"
                        ? git.find(([prefix]) => args.join(" ").startsWith(prefix))?.[1]
                        : TOOLS[command];
                return Promise.resolve(
                    answer ?? { ok: false, error: `${command} CLI not found on PATH` },
                );
            },
        env: { AUTONOMOUS_CONFIG: "/home/me/.config/autonomous/config.json", HOME: "/home/me" },
        readConfig: options.readConfig ?? missingFile,
        cwd: options.cwd ?? `${ROOT}/src`,
        home: "/home/me",
        tmpdir: tmp,
        now: () => new Date("2026-11-22T19:55:01Z"),
        exists: (path) => path === `${ROOT}/package.json`,
        fallowPlugin: () => Promise.resolve(true),
        briefsDir: BRIEFS_DIR,
        collect: (dir, collectDeps) => {
            collected.push({ dir, ...collectDeps });
            return Promise.resolve(options.collected ?? { ok: true, value: report() });
        },
        runners: { coderabbit: runner },
        stdout: (text) => stdout.push(text),
        stderr: (text) => stderr.push(text),
    };
    return { deps, calls, stdout, stderr, collected, contexts };
}

async function invoke(argv: string[], h = harness()) {
    const code = await main(argv, h.deps);
    return { code, ...h };
}

// A plan written by `plan` itself, at tier M, so the CodeRabbit CLI is in its team.
async function plannedDir(): Promise<string> {
    const dir = join(tmp, "review");
    const planned = await invoke(["plan", "--dir", dir], harness({ numstat: MEDIUM }));
    expect(planned.code).toBe(0);
    return dir;
}

beforeEach(() => {
    tmp = directories.make("tmp");
});

afterEach(async () => {
    await directories.removeAll();
});

describe("review-team CLI", () => {
    describe("plan", () => {
        it("prints only the new report directory, running every tool at the repository root", async () => {
            const result = await invoke(["plan"]);

            expect(result.code).toBe(0);
            expect(result.stderr).toEqual([]);
            expect(result.stdout).toEqual([
                join(tmp, "review-team", "my-repo-2222222-20261122T195501Z"),
            ]);
            const plan = JSON.parse(
                readFileSync(join(result.stdout[0]!, "plan.json"), "utf8"),
            ) as Plan;
            expect(plan.team.map((member) => member.reviewer)).toEqual([
                "walkthrough",
                "code-review",
                "codex",
            ]);
            expect(result.calls[0]).toMatchObject({
                command: "git",
                args: ["rev-parse", "--show-toplevel"],
                cwd: `${ROOT}/src`,
            });
            expect(result.calls.slice(1).every((call) => call.cwd === ROOT)).toBe(true);
            const timeouts = Object.fromEntries(
                result.calls.map((call) => [call.command, call.timeoutMs]),
            );
            expect(timeouts).toEqual({
                git: 120_000,
                gh: 120_000,
                codex: 30_000,
                claude: 30_000,
                plannotator: 30_000,
            });
        });

        it("honours --dir, relative to the working directory", async () => {
            const result = await invoke(["plan", "--dir", "review"], harness({ cwd: tmp }));

            expect(result.code).toBe(0);
            expect(result.stdout).toEqual([join(tmp, "review")]);
            expect(existsSync(join(tmp, "review", "plan.json"))).toBe(true);
        });

        it("passes --base, and records a raise with its reason", async () => {
            const result = await invoke([
                "plan",
                "--base",
                "develop",
                "--tier",
                "L",
                "--reason",
                "touches the label contract",
            ]);

            expect(result.code).toBe(0);
            const plan = JSON.parse(
                readFileSync(join(result.stdout[0]!, "plan.json"), "utf8"),
            ) as Plan;
            expect(plan.subject.base).toBe("develop");
            expect(plan.tier).toEqual({
                measured: "S",
                used: "L",
                reason: "touches the label contract",
            });
            expect(result.calls.some((call) => call.command === "gh")).toBe(false);
        });

        it("Lowering refused: exits 2 naming both tiers, and runs and writes nothing", async () => {
            const result = await invoke(
                ["plan", "--tier", "S", "--reason", "small enough"],
                harness({ numstat: MEDIUM }),
            );

            expect(result.code).toBe(2);
            expect(result.stdout).toEqual([]);
            expect(result.stderr).toEqual([
                "tier S is below the measured tier M: a tier can be raised, never lowered",
            ]);
            expect(readdirSync(tmp)).toEqual([]);
            expect(result.calls.every((call) => ["git", "gh"].includes(call.command))).toBe(true);
        });

        it("refuses a raise with no reason with exit 2", async () => {
            const result = await invoke(["plan", "--tier", "L"]);

            expect(result.code).toBe(2);
            expect(result.stderr).toEqual(["raising the tier from S to L needs a reason"]);
            expect(readdirSync(tmp)).toEqual([]);
        });

        it("Invalid threshold: exits 1 naming the path, before any command runs", async () => {
            const invalid = JSON.parse(JSON.stringify(config())) as {
                review: { tiers: { S: { maxLines: number } } };
            };
            invalid.review.tiers.S.maxLines = -1;

            const result = await invoke(
                ["plan"],
                harness({ readConfig: () => JSON.stringify(invalid) }),
            );

            expect(result.code).toBe(1);
            expect(result.stderr[0]).toContain("$.review.tiers.S.maxLines");
            expect(result.calls).toEqual([]);
            expect(readdirSync(tmp)).toEqual([]);
        });

        it("exits 1 when a git call fails", async () => {
            const result = await invoke(
                ["plan"],
                harness({ failingGit: "symbolic-ref refs/remotes/origin/HEAD" }),
            );

            expect(result.code).toBe(1);
            expect(result.stdout).toEqual([]);
            expect(result.stderr[0]).toContain("no base given, no open pull request");
        });

        it("exits 1 outside a repository", async () => {
            const result = await invoke(
                ["plan"],
                harness({ failingGit: "rev-parse --show-toplevel" }),
            );

            expect(result.code).toBe(1);
            expect(result.stderr[0]).toMatch(/^finding the repository: /);
        });
    });

    describe("run", () => {
        it("runs the reviewer's runner and writes its file", async () => {
            const dir = await plannedDir();
            const h = harness();

            const result = await invoke(["run", "coderabbit", "--dir", dir], h);

            expect(result.code).toBe(0);
            expect(result.stdout).toEqual([]);
            expect(result.stderr).toEqual([]);
            const written = JSON.parse(
                readFileSync(join(dir, "reviewers", "coderabbit.json"), "utf8"),
            ) as unknown;
            expect(written).toEqual(reported);
            const [ctx] = h.contexts;
            expect(ctx?.dir).toBe(dir);
            expect(ctx?.row.reviewer).toBe("coderabbit");
            expect(ctx?.plan.tier.used).toBe("M");
            expect(ctx?.now()).toBe(Date.parse("2026-11-22T19:55:01Z"));
            await ctx?.exec("coderabbit", 900_000, { keepOutputOnExit: true })(["--version"]);
            expect(h.calls.at(-1)).toEqual({
                command: "coderabbit",
                args: ["--version"],
                timeoutMs: 900_000,
                cwd: ROOT,
                keepOutputOnExit: true,
            });
        });

        it("records a skip and still exits 0", async () => {
            const dir = await plannedDir();
            const skipped: ReviewerFile = {
                schema: FINDING_SCHEMA,
                reviewer: "coderabbit",
                outcome: "skipped",
                reason: "rate limited",
            };

            const result = await invoke(
                ["run", "coderabbit", "--dir", dir],
                harness({ file: skipped }),
            );

            expect(result.code).toBe(0);
            expect(result.stderr).toEqual(["coderabbit skipped: rate limited"]);
            expect(
                JSON.parse(readFileSync(join(dir, "reviewers", "coderabbit.json"), "utf8")),
            ).toEqual(skipped);
        });

        it.each([
            ["nobody", "unknown reviewer: nobody"],
            ["tests-lens", "tests-lens is not in the plan's team"],
            ["walkthrough", "walkthrough is a teammate: it writes its own file"],
            ["codex", "codex has no runner yet"],
        ])("exits 1 for a reviewer it cannot run: %s", async (reviewer, error) => {
            const dir = await plannedDir();
            const h = harness();

            const result = await invoke(["run", reviewer, "--dir", dir], h);

            expect(result.code).toBe(1);
            expect(result.stderr[0]).toContain(error);
            expect(h.contexts).toEqual([]);
            expect(existsSync(join(dir, "reviewers", `${reviewer}.json`))).toBe(false);
        });

        it("exits 1 when the directory holds no plan", async () => {
            const result = await invoke(["run", "coderabbit", "--dir", tmp]);

            expect(result.code).toBe(1);
            expect(result.stderr[0]).toMatch(/^reading plan\.json: /);
        });
    });

    describe("collect", () => {
        it("prints only the report's path, with git and plannotator at the repository root", async () => {
            const dir = join(tmp, "review");
            mkdirSync(dir);
            const h = harness();

            const result = await invoke(["collect", "--dir", dir], h);

            expect(result.code).toBe(0);
            expect(result.stdout).toEqual([join(dir, "report.md")]);
            expect(result.stderr).toEqual([]);
            expect(h.collected.map((entry) => entry.dir)).toEqual([dir]);
            await h.collected[0]?.git(["status"]);
            await h.collected[0]?.plannotator(["--version"]);
            expect(h.calls.slice(-2)).toEqual([
                { command: "git", args: ["status"], timeoutMs: 120_000, cwd: ROOT },
                { command: "plannotator", args: ["--version"], timeoutMs: 120_000, cwd: ROOT },
            ]);
        });

        it("exits 1 after printing the report's path when the report has errors", async () => {
            const errors = ["walkthrough is required and ended without writing its output"];

            const result = await invoke(
                ["collect", "--dir", tmp],
                harness({ collected: { ok: true, value: report(errors) } }),
            );

            expect(result.code).toBe(1);
            expect(result.stdout).toEqual([join(tmp, "report.md")]);
            expect(result.stderr).toEqual(errors);
        });

        it("exits 1 when no report could be written", async () => {
            const result = await invoke(
                ["collect", "--dir", tmp],
                harness({ collected: { ok: false, error: "reading plan.json: missing" } }),
            );

            expect(result.code).toBe(1);
            expect(result.stdout).toEqual([]);
            expect(result.stderr).toEqual(["reading plan.json: missing"]);
        });
    });

    it.each([
        [[], "expected plan, run or collect, got nothing"],
        [["review"], "expected plan, run or collect, got review"],
        [["run", "coderabbit"], "--dir is required"],
        [["collect"], "--dir is required"],
        [["run", "--dir", "/tmp/x"], "run needs a reviewer"],
        [["plan", "--reason", "because"], "--reason is only accepted with --tier"],
        [["plan", "--tier", "XL", "--reason", "big"], "invalid --tier: XL"],
        [["plan", "--base"], "missing value for --base"],
        [["plan", "--base", "main", "--base", "develop"], "--base given twice"],
        [["collect", "--dir", "/tmp/x", "--tier", "L"], "unknown flag: --tier"],
    ])("rejects a usage error with exit 1: %j", async (argv, error) => {
        const result = await invoke(argv);

        expect(result.code).toBe(1);
        expect(result.stdout).toEqual([]);
        expect(result.stderr).toEqual([`${error}\n${USAGE}`]);
        expect(result.calls).toEqual([]);
    });
});
