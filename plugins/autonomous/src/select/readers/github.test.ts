import { expect, it, vi } from "vitest";
import type { Exec } from "../../exec.ts";
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
    blockedBy: null,
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

it("marks priority, blockers and children unevaluated for every GitHub task until detail", async () => {
    const { exec, work } = reading(listing);
    const result = await work.list();
    if (!result.ok) throw new Error(result.error);
    expect(result.value).toHaveLength(2);
    for (const task of result.value) {
        expect(task.priority).toBeNull();
        expect(task.blockedBy).toBeNull();
        expect(task.children).toBeNull();
        expect(task.blocks).toEqual([]);
    }
    expect(exec).toHaveBeenCalledTimes(2);
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
