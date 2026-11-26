import { expect, it, vi } from "vitest";
import type { Exec } from "../../exec.ts";
import { LIST_LIMIT } from "../../label-triage/trackers/github.ts";
import blockedByCut from "./fixtures/github-blockedby-cut.json";
import blockerClosed from "./fixtures/github-blocker-closed.json";
import blockerForeign from "./fixtures/github-blocker-foreign.json";
import blockerHidden from "./fixtures/github-blocker-hidden.json";
import blockerOpen from "./fixtures/github-blocker-open.json";
import blocking from "./fixtures/github-blocking.json";
import blockingCut from "./fixtures/github-blocking-cut.json";
import listing from "./fixtures/github-list.json";
import subIssues from "./fixtures/github-subissues.json";
import { githubWorkReader } from "./github.ts";
import type { WorkTask } from "../types.ts";

const CONFIG = { enabled: true, repos: ["demo/one", "demo/two"] };

const PARENT: WorkTask = {
    source: "github",
    id: "ghrecon-ec0359/sv-issues#9",
    title: "Parent issue with sub-issues",
    description: "Example description",
    labels: ["personal", "grill-me"],
    status: "OPEN",
    closed: false,
    updatedAt: "2026-01-01T00:00:00Z",
    priority: null,
    project: null,
    repository: "ghrecon-ec0359/sv-issues",
    blockedBy: [],
    children: null,
    blocks: [],
};

function reading(stdout: unknown) {
    const exec = vi.fn<Exec>().mockResolvedValue({ ok: true, stdout: JSON.stringify(stdout) });
    return { exec, work: githubWorkReader(exec, CONFIG) };
}

function withNodes(nodes: unknown[]) {
    return { subIssues: { nodes, totalCount: nodes.length } };
}

it("leaves priority and children unevaluated for every GitHub task until detail", async () => {
    const { work } = reading(listing);
    const result = await work.list();
    if (!result.ok) throw new Error(result.error);
    expect(result.value).toHaveLength(2);
    for (const task of result.value) {
        expect(task.priority).toBeNull();
        expect(task.children).toBeNull();
        expect(task.blockedBy).toEqual([]);
        expect(task.blocks).toEqual([]);
    }
});

it("lists each configured repository once, asking for the blockers in the same call", async () => {
    const { exec, work } = reading(listing);
    await work.list();
    expect(exec).toHaveBeenCalledTimes(2);
    for (const [index, repo] of CONFIG.repos.entries()) {
        const args = exec.mock.calls[index]![0];
        expect(args.slice(0, 4)).toEqual(["issue", "list", "--repo", repo]);
        expect(args[args.indexOf("--limit") + 1]).toBe(LIST_LIMIT);
        expect(args[args.indexOf("--json") + 1]).toBe(
            "number,title,body,labels,updatedAt,state,blockedBy,blocking",
        );
    }
});

async function listOne(stdout: unknown) {
    const exec = vi.fn<Exec>().mockResolvedValue({ ok: true, stdout: JSON.stringify(stdout) });
    return githubWorkReader(exec, { enabled: true, repos: ["demo/one"] }).list();
}

it("has an open blocker when a blockedBy node is OPEN", async () => {
    expect(await listOne(blockerOpen)).toMatchObject({
        ok: true,
        value: [{ id: "demo/one#7", blockedBy: ["demo/one#3"] }],
    });
});

it("has no open blocker when every blocker is closed, whatever the reason", async () => {
    expect(await listOne(blockerClosed)).toMatchObject({
        ok: true,
        value: [{ id: "demo/one#7", blockedBy: [] }],
    });
});

it("counts an open blocker of a repository outside the configuration", async () => {
    expect(await listOne(blockerForeign)).toMatchObject({
        ok: true,
        value: [{ id: "demo/one#7", blockedBy: ["other/elsewhere#12"] }],
    });
});

it("blocks only the open tasks of the blocking list, from any repository", async () => {
    expect(await listOne(blocking)).toMatchObject({
        ok: true,
        value: [{ id: "demo/one#3", blocks: ["demo/one#7"] }],
    });
});

async function failure(stdout: unknown): Promise<string> {
    const result = await listOne(stdout);
    if (result.ok) throw new Error("expected the read to fail");
    return result.error;
}

it("fails naming the task, the field and both counts when blockedBy is cut short", async () => {
    expect(await failure(blockedByCut)).toContain(
        "demo/one#7 blockedBy has totalCount 51 but 50 nodes",
    );
});

it("fails naming the task and the field when blocking is cut short", async () => {
    expect(await failure(blockingCut)).toContain(
        "demo/one#7 blocking has totalCount 51 but 50 nodes",
    );
});

it("fails naming the task when a blocker has no node, as for one the token cannot see", async () => {
    expect(await failure(blockerHidden)).toContain(
        "demo/one#7 blockedBy has totalCount 1 but 0 nodes",
    );
});

it("reads the repository from each task id and no project", async () => {
    const { work } = reading(listing);
    const result = await work.list();
    if (!result.ok) throw new Error(result.error);
    expect(
        result.value.map(({ id, repository, project }) => ({ id, repository, project })),
    ).toEqual([
        { id: "demo/one#7", repository: "demo/one", project: null },
        { id: "demo/two#7", repository: "demo/two", project: null },
    ]);
});

it("asks gh for the sub-issues of the task in its own repository", async () => {
    const { exec, work } = reading(subIssues);
    await work.detail(PARENT);
    expect(exec).toHaveBeenCalledExactlyOnceWith([
        "issue",
        "view",
        "9",
        "--repo",
        "ghrecon-ec0359/sv-issues",
        "--json",
        "subIssues",
    ]);
});

it("keeps the open sub-issues as children, and the closed one out, leaving the task as listed", async () => {
    const { work } = reading(subIssues);
    expect(await work.detail(PARENT)).toEqual({
        ok: true,
        value: {
            ...PARENT,
            children: ["ghrecon-ec0359/sv-issues#10", "ghrecon-ec0359/sv-issues#11"],
        },
    });
});

it("gives a sub-issue of another repository the id of that repository", async () => {
    const [first, ...rest] = subIssues.subIssues.nodes;
    const elsewhere = { ...first!, url: "https://github.com/other/repo/issues/10" };
    const { work } = reading(withNodes([elsewhere, ...rest]));
    expect(await work.detail(PARENT)).toMatchObject({
        ok: true,
        value: { children: ["other/repo#10", "ghrecon-ec0359/sv-issues#11"] },
    });
});

it("gives a sub-issue without a url the repository of the task", async () => {
    const nodes = subIssues.subIssues.nodes.map(({ url: _url, ...node }) => node);
    const { work } = reading(withNodes(nodes));
    expect(await work.detail(PARENT)).toMatchObject({
        ok: true,
        value: { children: ["ghrecon-ec0359/sv-issues#10", "ghrecon-ec0359/sv-issues#11"] },
    });
});

it("has no open children when every sub-issue is closed", async () => {
    const closed = subIssues.subIssues.nodes.map((node) => ({ ...node, state: "CLOSED" }));
    const { work } = reading(withNodes(closed));
    expect(await work.detail(PARENT)).toMatchObject({ ok: true, value: { children: [] } });
});

it("has no children when the issue has no sub-issues", async () => {
    const { work } = reading(withNodes([]));
    expect(await work.detail(PARENT)).toMatchObject({ ok: true, value: { children: [] } });
});

it("fails naming the command when gh fails", async () => {
    const exec = vi.fn<Exec>().mockResolvedValue({ ok: false, error: "gh failed: HTTP 502" });
    const work = githubWorkReader(exec, CONFIG);
    expect(await work.detail(PARENT)).toEqual({
        ok: false,
        error: "gh issue view 9 --repo ghrecon-ec0359/sv-issues --json subIssues: gh failed: HTTP 502",
    });
});

it("fails naming the command and the field when the sub-issues are missing from the output", async () => {
    const { work } = reading({});
    expect(await work.detail(PARENT)).toEqual({
        ok: false,
        error:
            "gh issue view 9 --repo ghrecon-ec0359/sv-issues --json subIssues: " +
            "output does not match the expected shape: $.subIssues must be an object",
    });
});

it("fails naming the node when a sub-issue has no state", async () => {
    const { work } = reading(withNodes([{ number: 10 }]));
    expect(await work.detail(PARENT)).toEqual({
        ok: false,
        error:
            "gh issue view 9 --repo ghrecon-ec0359/sv-issues --json subIssues: " +
            "output does not match the expected shape: $.subIssues.nodes[0].state must be a string",
    });
});
