// `gh` reads its repository from its working directory, so its exec is made with `cwd: directory`;
// every `git` command names the directory with `-C`.

import { CLI_TIMEOUT_MS, type Exec, execCommand } from "../exec.ts";
import type { Result } from "../result.ts";
import { ParseError, array, boolean, number, object, string } from "../validate.ts";
import {
    EMPTY_COMMIT_SUBJECT,
    type PullRequest,
    type PullRequests,
    type PullRequestsFactory,
} from "./port.ts";

// The commit and the push run the repository's hooks, and a pre-push hook can run a whole test
// suite, so those two get a long timeout. Both together stay under the 600 s the run command
// gives the whole process, so a slow hook is reported by name instead of the process being killed.
const HOOKED_TIMEOUT_MS = 240_000;

export interface GitHubExecs {
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
    };
}

export const ghPullRequests: PullRequestsFactory = (directory) =>
    gitHubPullRequests(
        {
            gh: execCommand("gh", CLI_TIMEOUT_MS, { cwd: directory }),
            git: execCommand("git"),
            hooked: execCommand("git", HOOKED_TIMEOUT_MS),
        },
        directory,
    );
