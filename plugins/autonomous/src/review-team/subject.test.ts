import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Exec } from "../exec.ts";
import { gitSync, isolatedGit, temporaryDirectories } from "../stages/test-fixtures.ts";
import { gitStatus, insideRepository, resolveSubject, treeFingerprint } from "./subject.ts";

const directories = temporaryDirectories("review-subject");
let clone: string;
let calls: string[];

const git: Exec = (args, input) => isolatedGit(["-C", clone, ...args], input);

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

    it("records a new file as dirty when the configuration hides untracked files", async () => {
        run("config", "status.showUntrackedFiles", "no");
        writeFileSync(join(clone, "new.md"), "new\n");

        const subject = await resolveSubject(deps(fakeGh(null)));

        expect(subject.ok && subject.value.dirty).toBe(true);
    });

    it("reads HEAD once and takes the merge base from that commit", async () => {
        const heads = ["1".repeat(40), "2".repeat(40)];
        const asked: string[] = [];
        const moving: Exec = (args) => {
            asked.push(args.join(" "));
            const answers: Record<string, () => string> = {
                "rev-parse --abbrev-ref HEAD": () => "feature/work",
                "rev-parse HEAD": () => heads.shift() ?? "", // HEAD moves after each read
                [`merge-base origin/main ${"1".repeat(40)}`]: () => "a".repeat(40),
                [`merge-base origin/main ${"2".repeat(40)}`]: () => "b".repeat(40),
            };
            const answer = answers[args.join(" ")]?.() ?? "";
            return Promise.resolve({ ok: true, stdout: `${answer}\n` });
        };

        const subject = await resolveSubject(
            { git: moving, gh: fakeGh(null), repoRoot: clone },
            "main",
        );

        expect(subject.ok && subject.value).toMatchObject({
            head: "1".repeat(40),
            mergeBase: "a".repeat(40),
        });
        expect(asked.filter((call) => call === "rev-parse HEAD")).toHaveLength(1);
        expect(asked.filter((call) => call.startsWith("merge-base"))).toEqual([
            `merge-base origin/main ${"1".repeat(40)}`,
        ]);
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

    it("lists a new file even when the configuration hides untracked files", async () => {
        run("config", "status.showUntrackedFiles", "no");
        writeFileSync(join(clone, "new.md"), "new\n");

        expect(await gitStatus(git)).toEqual({ ok: true, value: "?? new.md\n" });
    });

    it("leaves out the path it is given, and still reports any other change", async () => {
        mkdirSync(join(clone, "review-out"));
        writeFileSync(join(clone, "review-out", "plan.json"), "{}\n");

        expect(await gitStatus(git)).toEqual({ ok: true, value: "?? review-out/\n" });
        expect(await gitStatus(git, "review-out")).toEqual({ ok: true, value: "" });

        writeFileSync(join(clone, "new.md"), "new\n");

        expect(await gitStatus(git, "review-out")).toEqual({ ok: true, value: "?? new.md\n" });
    });
});

describe("treeFingerprint", () => {
    async function fingerprint(leaveOut?: string): Promise<string> {
        const result = await treeFingerprint(git, leaveOut);
        if (!result.ok) {
            throw new Error(result.error);
        }
        return result.value;
    }

    it("is a sha256 digest that stays the same while the tree does", async () => {
        const clean = await fingerprint();

        expect(clean).toMatch(/^[0-9a-f]{64}$/);
        expect(await fingerprint()).toBe(clean);
    });

    it("changes when a file already modified is edited again, though its status line does not", async () => {
        writeFileSync(join(clone, "work.md"), "changed\n");
        const [status, before] = [await gitStatus(git), await fingerprint()];

        writeFileSync(join(clone, "work.md"), "changed again\n");

        expect(await gitStatus(git)).toEqual(status);
        expect(await fingerprint()).not.toBe(before);
    });

    it("changes when an untracked file is edited again, and writes no object", async () => {
        writeFileSync(join(clone, "new.md"), "new\n");
        const before = await fingerprint();

        writeFileSync(join(clone, "new.md"), "newer\n");

        expect(await fingerprint()).not.toBe(before);
        // The blob ids of "new\n" and "newer\n".
        for (const blob of [
            "3e757656cf36eca53338e520d134963a44f793f8",
            "d58ed19c91e09e9cc931ac08e57009004eebcb52",
        ]) {
            expect((await git(["cat-file", "-e", blob])).ok, blob).toBe(false);
        }
    });

    it("leaves out the path it is given, and still sees any other change", async () => {
        const before = await fingerprint("review-out");
        mkdirSync(join(clone, "review-out"));
        writeFileSync(join(clone, "review-out", "plan.json"), "{}\n");

        expect(await fingerprint("review-out")).toBe(before);
        expect(await fingerprint()).not.toBe(before);

        writeFileSync(join(clone, "work.md"), "changed\n");

        expect(await fingerprint("review-out")).not.toBe(before);
    });

    it("fails when a git call fails", async () => {
        const failing: Exec = () => Promise.resolve({ ok: false, error: "git failed: boom" });

        expect(await treeFingerprint(failing)).toEqual({ ok: false, error: "git failed: boom" });
    });
});

describe("insideRepository", () => {
    it("is the path from the root when the directory is inside the repository", () => {
        expect(insideRepository("/work/repo", "/work/repo/review-out")).toBe("review-out");
        expect(insideRepository("/work/repo", "/work/repo/a/b")).toBe(join("a", "b"));
    });

    it("is nothing for the root itself or a directory outside it", () => {
        expect(insideRepository("/work/repo", "/work/repo")).toBeUndefined();
        expect(insideRepository("/work/repo", "/work/other")).toBeUndefined();
        expect(insideRepository("/work/repo", "/tmp/review-team/x")).toBeUndefined();
    });

    it("keeps a directory whose name only starts with two dots", () => {
        expect(insideRepository("/work/repo", "/work/repo/..out")).toBe("..out");
    });
});

describe("resolveSubject: a report directory in the repository", () => {
    it("is not a change of the working tree", async () => {
        mkdirSync(join(clone, "review-out"));
        writeFileSync(join(clone, "review-out", "plan.json"), "{}\n");

        const left = await resolveSubject(
            { ...deps(fakeGh(null)), leaveOut: "review-out" },
            "main",
        );
        const counted = await resolveSubject(deps(fakeGh(null)), "main");

        expect(left.ok && left.value.dirty).toBe(false);
        expect(counted.ok && counted.value.dirty).toBe(true);
    });
});
