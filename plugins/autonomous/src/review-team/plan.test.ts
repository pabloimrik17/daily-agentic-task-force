import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { shippedReview } from "../config.ts";
import type { Exec, ExecResult } from "../exec.ts";
import { gitSync, isolatedGit, temporaryDirectories } from "../stages/test-fixtures.ts";
import { parsePlan } from "./plan-file.ts";
import { buildPlan, type PlanDeps, type PlanRequest } from "./plan.ts";
import type { Plan } from "./types.ts";

const BRIEFS_DIR = fileURLToPath(new URL("../../skills/review-team/reviewers", import.meta.url));
const NOW = new Date("2026-11-22T19:55:01.123Z");

const directories = temporaryDirectories("review-plan");
let clone: string;
let tmp: string;
let calls: string[];

type Answers = Record<string, ExecResult>;

// Every reviewer's check passes: logged in, authenticated, on the PATH.
const AVAILABLE: Answers = {
    codex: { ok: true, stdout: "codex-cli 0.169.0\n" },
    coderabbit: { ok: true, stdout: '{"type":"status","authenticated":true}\n' },
    fallow: { ok: true, stdout: "fallow 2.1.0\n" },
    claude: { ok: true, stdout: "2.1.300 (Claude Code)\n" },
    plannotator: { ok: true, stdout: "0.29.2\n" },
};

// git runs in the clone; `gh` finds no pull request; every other tool answers from `answers`,
// and one with no answer is not on the PATH.
function execFor(answers: Answers): PlanDeps["exec"] {
    return (command): Exec =>
        (args) => {
            calls.push(`${command} ${args.join(" ")}`);
            if (command === "git") {
                return isolatedGit(["-C", clone, ...args]);
            }
            if (command === "gh") {
                return Promise.resolve({ ok: false, error: "gh failed: no pull requests found" });
            }
            return Promise.resolve(
                answers[command] ?? { ok: false, error: `${command} CLI not found on PATH` },
            );
        };
}

function deps(overrides: Partial<PlanDeps> = {}, answers: Answers = AVAILABLE): PlanDeps {
    return {
        exec: execFor(answers),
        repoRoot: clone,
        home: homedir(),
        tmpdir: tmp,
        now: () => NOW,
        exists: (path) => path === join(clone, "package.json"),
        fallowPlugin: () => Promise.resolve(true),
        review: shippedReview(),
        briefsDir: BRIEFS_DIR,
        ...overrides,
    };
}

function commit(files: Record<string, string>): void {
    for (const [name, content] of Object.entries(files)) {
        writeFileSync(join(clone, name), content);
        gitSync(["-C", clone, "add", name]);
    }
    gitSync(["-C", clone, "commit", "-q", "-m", "work"]);
}

const lines = (count: number): string =>
    Array.from({ length: count }, (_, index) => `line ${index}`).join("\n") + "\n";

async function plan(request: PlanRequest = {}, planDeps = deps()) {
    const result = await buildPlan(request, planDeps);
    if (!result.ok) {
        throw new Error(result.error);
    }
    return result.value;
}

const ids = (planned: Plan): string[] => planned.team.map((member) => member.reviewer);

// An origin with one commit on `main`, cloned as `my-repo` (so `origin/HEAD` names `main`) and
// checked out on `feature/work`.
beforeEach(() => {
    calls = [];
    tmp = directories.make("tmp");
    const origin = directories.make("origin");
    gitSync(["-C", origin, "init", "-q", "-b", "main"]);
    writeFileSync(join(origin, "README.md"), "base\n");
    gitSync(["-C", origin, "add", "README.md"]);
    gitSync(["-C", origin, "commit", "-q", "-m", "base"]);
    clone = join(directories.make("clone"), "my-repo");
    gitSync(["clone", "-q", origin, clone]);
    gitSync(["-C", clone, "checkout", "-q", "-b", "feature/work"]);
});

afterEach(async () => {
    await directories.removeAll();
});

describe("buildPlan", () => {
    it("Tier M: resolves the tier's team with each row's engine", async () => {
        commit({ "big.ts": lines(200) });

        const { plan: planned } = await plan();

        expect(planned.measure).toEqual({ lines: 200, files: 1 });
        expect(planned.tier).toEqual({ measured: "M", used: "M" });
        expect(planned.subject).toMatchObject({
            repo: "my-repo",
            branch: "feature/work",
            base: "main",
            baseSource: "default-branch",
            dirty: false,
        });
        expect(ids(planned)).toEqual([
            "walkthrough",
            "code-review",
            "codex",
            "coderabbit",
            "fallow-review",
        ]);
        expect(planned.skipped).toEqual([]);
        expect(planned.security).toEqual({ triggered: false, matches: [] });
        expect(planned.guide).toEqual({ available: true });
        expect(planned.team[1]).toEqual({
            reviewer: "code-review",
            angle: "correctness",
            kind: "teammate",
            required: false,
            engine: { tool: "claude-code", version: "2.1.300 (Claude Code)", level: "high" },
            brief: "briefs/code-review.md",
            output: "reviewers/code-review.json",
        });
        expect(planned.team[2]).toEqual({
            reviewer: "codex",
            angle: "correctness from another model family",
            kind: "cli",
            required: false,
            engine: { tool: "codex", version: "codex-cli 0.169.0", effort: "medium" },
            output: "reviewers/codex.json",
        });
        expect(planned.team[0]?.required).toBe(true);
        expect(calls.filter((call) => call === "claude --version")).toHaveLength(1);
    });

    it("moves an unavailable reviewer to skipped with its reason", async () => {
        commit({ "small.ts": lines(10) });
        const answers: Answers = {
            ...AVAILABLE,
            codex: { ok: false, error: "codex failed: Not logged in" },
        };

        const { plan: planned } = await plan({}, deps({}, answers));

        expect(ids(planned)).toEqual(["walkthrough", "code-review"]);
        expect(planned.skipped).toEqual([{ reviewer: "codex", reason: "not logged in" }]);
    });

    it("records a missing plannotator as no guide, keeping the walkthrough", async () => {
        commit({ "small.ts": lines(10) });
        const { plannotator: _absent, ...answers } = AVAILABLE;

        const { plan: planned } = await plan({}, deps({}, answers));

        expect(ids(planned)).toContain("walkthrough");
        expect(planned.guide).toEqual({
            available: false,
            reason: "plannotator CLI not found on PATH",
        });
    });

    it("Shell execution added: the security reviewer joins, naming the pattern and the line", async () => {
        commit({ "run.ts": 'import { execFile } from "node:child_process";\nexecFile("ls");\n' });

        const { dir, plan: planned } = await plan();

        expect(planned.tier.used).toBe("S");
        expect(ids(planned)).toEqual(["walkthrough", "code-review", "codex", "security-review"]);
        expect(planned.security.triggered).toBe(true);
        expect(planned.security.matches).toContainEqual({
            kind: "line",
            pattern: String.raw`\b(exec|execFile|execSync|execFileSync|spawn|spawnSync)\s*\(`,
            file: "run.ts",
            line: 2,
        });
        expect(existsSync(join(dir, "briefs", "security-review.md"))).toBe(true);
    });

    describe("the security reviewer and the base", () => {
        const shell = { "run.ts": 'execFile("ls");\n' };
        const offBase = (base: string) =>
            `not applicable: /security-review always reviews against the default branch, and the base is ${base}`;

        it("joins when the given base is the default branch", async () => {
            commit(shell);

            const { plan: planned } = await plan({ base: "main" });

            expect(ids(planned)).toContain("security-review");
            expect(planned.skipped).toEqual([]);
        });

        it("is skipped as not applicable when the base is not the default branch", async () => {
            gitSync(["-C", clone, "branch", "develop", "origin/main"]);
            commit(shell);

            const { dir, plan: planned } = await plan({ base: "develop" });

            expect(ids(planned)).not.toContain("security-review");
            expect(planned.security.triggered).toBe(true);
            expect(planned.skipped).toEqual([
                { reviewer: "security-review", reason: offBase("develop") },
            ]);
            expect(existsSync(join(dir, "briefs", "security-review.md"))).toBe(false);
        });

        it("is skipped for a given base when the default branch cannot be read", async () => {
            gitSync(["-C", clone, "remote", "set-head", "origin", "-d"]);
            commit(shell);

            const { plan: planned } = await plan({ base: "main" });

            expect(planned.skipped).toEqual([
                { reviewer: "security-review", reason: offBase("main") },
            ]);
        });

        it("asks git for the default branch only when the security reviewer is in the team", async () => {
            commit({ "small.ts": lines(10) });

            await plan({ base: "main" });

            expect(calls).not.toContain("git symbolic-ref refs/remotes/origin/HEAD");
        });
    });

    it("Raised with a reason: runs at the raised tier and records both and the reason", async () => {
        commit({ "small.ts": lines(10) });

        const { plan: planned } = await plan({ tier: "L", reason: "touches the label contract" });

        expect(planned.tier).toEqual({
            measured: "S",
            used: "L",
            reason: "touches the label contract",
        });
        expect(ids(planned)).toContain("tests-lens");
    });

    it("Lowering refused: refuses before any check runs or any directory is made", async () => {
        commit({ "big.ts": lines(200) });

        const result = await buildPlan({ tier: "S", reason: "small enough" }, deps());

        expect(result).toEqual({
            ok: false,
            refused: true,
            error: "tier S is below the measured tier M: a tier can be raised, never lowered",
        });
        expect(readdirSync(tmp)).toEqual([]);
        expect(calls.every((call) => call.startsWith("git ") || call.startsWith("gh "))).toBe(true);
    });

    it("reports a failed git call as an error, not a refusal", async () => {
        const result = await buildPlan({ base: "no-such-branch" }, deps());

        expect(result.ok).toBe(false);
        expect(result).not.toHaveProperty("refused");
        expect(readdirSync(tmp)).toEqual([]);
    });

    it("Run by hand: makes a new directory under the temp directory, outside the repository", async () => {
        commit({ "small.ts": lines(10) });
        const head = readFileSync(join(clone, ".git", "refs", "heads", "feature", "work"), "utf8");

        const { dir } = await plan();

        expect(dir).toBe(join(tmp, "review-team", `my-repo-${head.slice(0, 7)}-20261122T195501Z`));
        expect(dir.startsWith(clone)).toBe(false);
        expect(readdirSync(dir).sort()).toEqual(["briefs", "plan.json", "raw", "reviewers"]);
        expect(readdirSync(join(dir, "briefs")).sort()).toEqual([
            "code-review.md",
            "walkthrough.md",
        ]);
    });

    it("Run for a stage: writes into the directory the caller names", async () => {
        commit({ "small.ts": lines(10) });
        const named = join(directories.make("attempt"), "review");

        const { dir } = await plan({ dir: named });

        expect(dir).toBe(named);
        expect(existsSync(join(named, "plan.json"))).toBe(true);
        expect(readdirSync(tmp)).toEqual([]);
    });

    it("fills every placeholder of every teammate's brief", async () => {
        commit({ "big.ts": lines(200) });

        const { dir, plan: planned } = await plan({ tier: "L", reason: "a full team" });

        const subject = planned.subject;
        for (const member of planned.team.filter((entry) => entry.kind === "teammate")) {
            const brief = readFileSync(join(dir, member.brief!), "utf8");
            expect(brief, member.reviewer).not.toMatch(/\{\{|\}\}/);
            expect(brief).toContain(`You are the \`${member.reviewer}\` reviewer`);
            expect(brief).toContain(join(dir, "reviewers", `${member.reviewer}.json`));
            expect(brief).toContain(`git diff ${subject.mergeBase} ${subject.head}`);
            expect(brief).toContain(`base with \`${subject.base}\``);
        }
        const codeReview = readFileSync(join(dir, "briefs", "code-review.md"), "utf8");
        expect(codeReview).toContain(`/code-review xhigh ${subject.mergeBase}`);
        expect(codeReview).toContain("important, pre_existing, nit");
        const walkthrough = readFileSync(join(dir, "briefs", "walkthrough.md"), "utf8");
        expect(walkthrough).toContain(join(dir, "walkthrough.json"));
        expect(walkthrough).toContain("CRITICAL, WARNING, SUGGESTION");
    });

    it("runs /code-review at medium when the row names no level", async () => {
        commit({ "small.ts": lines(10) });
        const review = shippedReview();
        review.team.S = [{ reviewer: "code-review" }];

        const { dir, plan: planned } = await plan({}, deps({ review }));

        const brief = readFileSync(join(dir, "briefs", "code-review.md"), "utf8");
        expect(brief).toContain(`/code-review medium ${planned.subject.mergeBase}`);
        expect(planned.team[0]?.engine).toEqual({
            tool: "claude-code",
            version: "2.1.300 (Claude Code)",
        });
    });

    it("refuses a brief with an unknown placeholder before writing anything", async () => {
        commit({ "small.ts": lines(10) });
        const briefsDir = directories.make("briefs");
        writeFileSync(join(briefsDir, "walkthrough.md"), "Write to {{OUTPUT}} and {{NOPE}}.\n");
        writeFileSync(join(briefsDir, "code-review.md"), "{{REVIEWER}}\n");

        const result = await buildPlan({}, deps({ briefsDir }));

        expect(result).toEqual({
            ok: false,
            error: "the brief walkthrough.md has unknown placeholders: {{NOPE}}",
        });
        expect(readdirSync(tmp)).toEqual([]);
    });

    it("writes a plan.json with no absolute path and no home directory", async () => {
        mkdirSync(join(clone, "src"));
        commit({ "src/auth.ts": "export const token = 1;\n" });
        writeFileSync(join(clone, "untracked.txt"), "dirty\n");

        const { dir, plan: planned } = await plan();

        const text = readFileSync(join(dir, "plan.json"), "utf8");
        expect(JSON.parse(text)).toEqual(planned);
        expect(parsePlan(JSON.parse(text))).toEqual({ ok: true, value: planned });
        expect(planned.subject.dirty).toBe(true);
        expect(planned.status).toBe("?? untracked.txt\n");
        expect(text).not.toContain(homedir());
        expect(text).not.toContain(clone);
        expect(text).not.toContain(tmp);
        const strings = (value: unknown): string[] =>
            typeof value === "string"
                ? [value]
                : typeof value === "object" && value !== null
                  ? Object.values(value).flatMap(strings)
                  : [];
        expect(strings(planned).filter((value) => value.startsWith("/"))).toEqual([]);
    });
});
