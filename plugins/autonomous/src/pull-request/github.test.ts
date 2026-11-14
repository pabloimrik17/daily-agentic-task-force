import { expect, it, vi } from "vitest";
import type { Exec } from "../exec.ts";
import type { Result } from "../result.ts";
import { gitHubPullRequests } from "./github.ts";
import comments from "./fixtures/pr-view-comments.json";
import emptyList from "./fixtures/pr-list-empty.json";
import list from "./fixtures/pr-list.json";
import repoView from "./fixtures/repo-view.json";

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

const OPEN = { base: "main", branch: "feature/x", title: "T", bodyFile: "/b.md" };

it("reads the default branch from gh repo view", async () => {
    const { execs, port } = setup(JSON.stringify(repoView));
    expect(await port.defaultBranch()).toEqual({ ok: true, value: "main" });
    expect(execs.gh).toHaveBeenCalledWith(["repo", "view", "--json", "defaultBranchRef"]);
});

it("finds the first open pull request of a branch", async () => {
    const { execs, port } = setup(JSON.stringify(list));
    expect(await port.find("feature/x")).toEqual({ ok: true, value: list[0] });
    expect(execs.gh).toHaveBeenCalledWith([
        "pr",
        "list",
        "--head",
        "feature/x",
        "--state",
        "open",
        "--json",
        "number,url,title",
    ]);
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
