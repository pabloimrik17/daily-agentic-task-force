import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Exec } from "../exec.ts";
import { gitSync, isolatedGit, temporaryDirectories } from "../stages/test-fixtures.ts";
import { gitStatus, resolveSubject } from "./subject.ts";

const directories = temporaryDirectories("review-subject");
let clone: string;
let calls: string[];

const git: Exec = (args) => isolatedGit(["-C", clone, ...args]);

function run(...args: string[]): void {
    gitSync(["-C", clone, ...args]);
}

function commitFile(name: string): void {
    writeFileSync(join(clone, name), `${name}\n`);
    run("add", name);
    run("commit", "-m", name);
}

async function revParse(ref: string): Promise<string> {
    const result = await git(["rev-parse", ref]);
    if (!result.ok) {
        throw new Error(result.error);
    }
    return result.stdout.trim();
}

// A `gh` that answers `pr view` with `answer`, logging each call.
function fakeGh(answer: { baseRefName: string; state: string } | null): Exec {
    return (args) => {
        calls.push(`gh ${args.join(" ")}`);
        return Promise.resolve(
            answer === null
                ? { ok: false, error: "gh failed: no pull requests found for branch" }
                : { ok: true, stdout: `${JSON.stringify(answer)}\n` },
        );
    };
}

const deps = (gh: Exec) => ({ git, gh, repoRoot: clone });

// An origin whose `main` and `develop` have diverged, cloned with `origin/HEAD` pointing at
// `main`, and checked out on `feature/work`, one commit ahead of `origin/develop`.
beforeEach(() => {
    calls = [];
    const origin = directories.make("origin");
    gitSync(["-C", origin, "init", "-b", "main"]);
    writeFileSync(join(origin, "README.md"), "base\n");
    gitSync(["-C", origin, "add", "README.md"]);
    gitSync(["-C", origin, "commit", "-m", "base"]);
    gitSync(["-C", origin, "checkout", "-b", "develop"]);
    writeFileSync(join(origin, "develop.md"), "develop\n");
    gitSync(["-C", origin, "add", "develop.md"]);
    gitSync(["-C", origin, "commit", "-m", "develop"]);
    gitSync(["-C", origin, "checkout", "main"]);
    clone = join(directories.make("clone"), "my-repo");
    gitSync(["clone", "-q", origin, clone]);
    run("checkout", "-q", "-b", "feature/work", "origin/develop");
    commitFile("work.md");
});

afterEach(async () => {
    await directories.removeAll();
});

describe("resolveSubject", () => {
    it("Branch with an open pull request: the merge base with the pull request's base", async () => {
        const subject = await resolveSubject(
            deps(fakeGh({ baseRefName: "develop", state: "OPEN" })),
        );

        expect(subject).toEqual({
            ok: true,
            value: {
                repo: "my-repo",
                branch: "feature/work",
                base: "develop",
                baseSource: "pull-request",
                mergeBase: await revParse("origin/develop"),
                head: await revParse("HEAD"),
                dirty: false,
            },
        });
        expect(calls).toEqual(["gh pr view --json baseRefName,state"]);
    });

    it("Branch with no pull request: the merge base with the default branch", async () => {
        const subject = await resolveSubject(deps(fakeGh(null)));

        expect(subject.ok && subject.value).toMatchObject({
            base: "main",
            baseSource: "default-branch",
            mergeBase: await revParse("origin/main"),
        });
    });

    it("a pull request that is no longer open falls through to the default branch", async () => {
        const subject = await resolveSubject(
            deps(fakeGh({ baseRefName: "develop", state: "MERGED" })),
        );

        expect(subject.ok && subject.value).toMatchObject({
            base: "main",
            baseSource: "default-branch",
        });
    });

    it("a given base wins over the pull request's, and gh is not asked", async () => {
        const subject = await resolveSubject(
            deps(fakeGh({ baseRefName: "develop", state: "OPEN" })),
            "main",
        );

        expect(subject.ok && subject.value).toMatchObject({
            base: "main",
            baseSource: "given",
            mergeBase: await revParse("origin/main"),
        });
        expect(calls).toEqual([]);
    });

    it("a given base with no remote-tracking ref is used as a local ref", async () => {
        run("branch", "local-base", "HEAD~1");
        commitFile("more.md");

        const subject = await resolveSubject(deps(fakeGh(null)), "local-base");

        expect(subject.ok && subject.value).toMatchObject({
            base: "local-base",
            mergeBase: await revParse("local-base"),
        });
    });

    it("records a dirty tree, whose changes stay out of the subject", async () => {
        writeFileSync(join(clone, "work.md"), "changed\n");

        const subject = await resolveSubject(deps(fakeGh(null)));

        expect(subject.ok && subject.value).toMatchObject({
            dirty: true,
            head: await revParse("HEAD"),
        });
    });

    it("fails, naming why, when no base can be resolved", async () => {
        run("remote", "set-head", "origin", "--delete");

        const subject = await resolveSubject(deps(fakeGh(null)));

        expect(subject.ok).toBe(false);
        expect(!subject.ok && subject.error).toMatch(
            /^no base given, no open pull request, and git failed/,
        );
    });
});

describe("gitStatus", () => {
    it("is the porcelain status, empty on a clean tree", async () => {
        expect(await gitStatus(git)).toEqual({ ok: true, value: "" });

        writeFileSync(join(clone, "new.md"), "new\n");

        expect(await gitStatus(git)).toEqual({ ok: true, value: "?? new.md\n" });
    });
});
