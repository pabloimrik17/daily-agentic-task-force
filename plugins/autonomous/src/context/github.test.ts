import { describe, expect, it } from "vitest";
import parentFixture from "./fixtures/github-issue-parent.json";
import subtask from "./fixtures/github-issue-subtask.json";
import { githubContext } from "./github.ts";
import { execFailing, execPrinting, githubTask, valueOf } from "./test-fixtures.ts";

describe("githubContext", () => {
    it("GitHub task: holds its sub-issues and comments in order, no blockers, and the note that dependencies were not read", async () => {
        const exec = execPrinting(parentFixture);
        const result = await githubContext(exec).read(githubTask);
        expect(valueOf(result)).toMatchObject({
            comments: ["First synthetic comment.", "Second synthetic comment."],
            children: [
                {
                    id: "demo/one#10",
                    title: "Synthetic sub-issue A",
                    state: "OPEN",
                    url: "https://github.com/demo/one/issues/10",
                },
                { id: "demo/one#11", state: "CLOSED" },
            ],
            blockedBy: [],
            blocks: [],
            pullRequests: [],
            notes: ["github: dependencies were not read"],
        });
        expect(exec).toHaveBeenCalledWith([
            "issue",
            "view",
            "10",
            "--repo",
            "demo/one",
            "--json",
            "comments,subIssues,parent,closedByPullRequestsReferences",
        ]);
    });

    it("GitHub task: holds the linked pull requests and the parent without a description", async () => {
        const result = await githubContext(execPrinting(subtask)).read(githubTask);
        expect(valueOf(result)).toMatchObject({
            parent: {
                id: "demo/one#9",
                title: "Synthetic parent",
                state: "OPEN",
                url: "https://github.com/demo/one/issues/9",
                description: null,
            },
            pullRequests: [
                { title: "demo/one#14845", url: "https://github.com/demo/one/pull/14845" },
            ],
            notes: [
                "github: dependencies were not read",
                "github: the parent's description was not read",
            ],
        });
    });

    it("Task with no relations: holds none and only the dependencies note", async () => {
        const quiet = { ...parentFixture, comments: [], subIssues: { nodes: [], totalCount: 0 } };
        const result = await githubContext(execPrinting(quiet)).read(githubTask);
        expect(valueOf(result)).toMatchObject({
            comments: [],
            parent: null,
            children: [],
            pullRequests: [],
            notes: ["github: dependencies were not read"],
        });
    });

    it("Tracker read fails: names the command", async () => {
        const result = await githubContext(execFailing("gh failed: boom")).read(githubTask);
        expect(result).toEqual({
            ok: false,
            error: "gh issue view 10 --repo demo/one --json comments,subIssues,parent,closedByPullRequestsReferences: gh failed: boom",
        });
    });

    it("a missing field yields an empty list and a note", async () => {
        const { closedByPullRequestsReferences: _prs, ...printed } = subtask;
        const result = await githubContext(execPrinting(printed)).read(githubTask);
        expect(valueOf(result).pullRequests).toEqual([]);
        expect(valueOf(result).notes).toContain("github: linked pull requests were not read");
    });

    it("names a cross-repository sub-issue by the repository in its url", async () => {
        const printed = {
            ...parentFixture,
            subIssues: {
                nodes: [
                    {
                        id: "I_x",
                        number: 3,
                        state: "OPEN",
                        title: "Elsewhere",
                        url: "https://github.com/demo/two/issues/3",
                    },
                ],
                totalCount: 1,
            },
        };
        const result = await githubContext(execPrinting(printed)).read(githubTask);
        expect(result.ok && result.value.children.map(({ id }) => id)).toEqual(["demo/two#3"]);
    });
});
