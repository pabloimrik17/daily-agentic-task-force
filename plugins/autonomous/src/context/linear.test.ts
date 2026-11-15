import { describe, expect, it } from "vitest";
import type { Tracker } from "../label-triage/trackers/tracker.ts";
import attachment from "./fixtures/linear-api-attachment.json";
import blockers from "./fixtures/linear-api-blockers.json";
import children from "./fixtures/linear-api-children.json";
import empty from "./fixtures/linear-api-empty.json";
import { linearContext } from "./linear.ts";
import { execFailing, execPrinting, linearTask, valueOf } from "./test-fixtures.ts";

function reading(output: unknown, comments: Awaited<ReturnType<Tracker["readComments"]>>) {
    const exec = execPrinting(output);
    return { exec, reader: linearContext(exec, { readComments: () => Promise.resolve(comments) }) };
}

const GRILL = "autonomous · grill-me · linear:DEMO-110:grill-me:1 · stage summary saved";

describe("linearContext", () => {
    it("Linear task after a grill: reads the comment, the parent with its description and the blocker without its description", async () => {
        const { exec, reader } = reading(blockers, { ok: true, value: [GRILL] });
        const result = await reader.read(linearTask);
        expect(valueOf(result)).toMatchObject({
            comments: [GRILL],
            parent: {
                id: "DEMO-82",
                title: "Synthetic DEMO-82",
                state: "In Progress",
                url: "https://linear.app/demo/issue/DEMO-82/synthetic",
                description: "Synthetic parent description.",
            },
            blockedBy: [
                {
                    id: "DEMO-109",
                    title: "Synthetic DEMO-109",
                    state: "Done",
                    url: "https://linear.app/demo/issue/DEMO-109/synthetic",
                },
            ],
            blocks: [{ id: "DEMO-111", state: "Backlog" }],
        });
        expect(exec.mock.calls[0]![0].slice(0, 1)).toEqual(["api"]);
        expect(exec.mock.calls[0]![0].slice(2)).toEqual(["--variable", "id=DEMO-110"]);
    });

    it("Task with no relations: holds none", async () => {
        const { reader } = reading(empty, { ok: true, value: [] });
        const result = await reader.read(linearTask);
        expect(result).toEqual({
            ok: true,
            value: {
                comments: [],
                parent: null,
                children: [],
                blockedBy: [],
                blocks: [],
                related: [],
                duplicates: [],
                project: null,
                attachments: [],
                pullRequests: [],
                notes: [],
            },
        });
    });

    it("Tracker read fails: names the comments command", async () => {
        const { reader } = reading(empty, {
            ok: false,
            error: "linear issue comment list DEMO-110: boom",
        });
        expect(await reader.read(linearTask)).toEqual({
            ok: false,
            error: "linear issue comment list DEMO-110: boom",
        });
    });

    it("Tracker read fails: names the context command when the query fails", async () => {
        const reader = linearContext(execFailing("linear failed: boom"), {
            readComments: () => Promise.resolve({ ok: true, value: [] }),
        });
        expect(await reader.read(linearTask)).toEqual({
            ok: false,
            error: "linear api issue --variable id=DEMO-110: linear failed: boom",
        });
    });

    it("Linear attachments: reads the project, the attachment and the related issue", async () => {
        const { reader } = reading(attachment, { ok: true, value: [] });
        const result = await reader.read(linearTask);
        expect(valueOf(result)).toMatchObject({
            project: "Synthetic project",
            attachments: [
                {
                    title: "Synthetic attachment",
                    url: "https://example.com/synthetic-attachment",
                },
            ],
            related: [{ id: "DEMO-82", state: "In Progress" }],
            blockedBy: [],
        });
    });

    it("reads the children with their state and url", async () => {
        const { reader } = reading(children, { ok: true, value: [] });
        const result = await reader.read(linearTask);
        expect(result.ok && result.value.children.map(({ id, state }) => [id, state])).toEqual([
            ["DEMO-132", "In Progress"],
            ["DEMO-129", "Backlog"],
        ]);
    });

    it("reads duplicate and related relations from both directions and ignores the other types", async () => {
        const task = { identifier: "DEMO-1", title: "T", url: "u", state: { name: "Todo" } };
        const issue = {
            ...empty.data.issue,
            relations: {
                nodes: [{ type: "duplicate", relatedIssue: task }],
                pageInfo: { hasNextPage: false },
            },
            inverseRelations: {
                nodes: [
                    { type: "related", issue: task },
                    { type: "similar", issue: task },
                ],
                pageInfo: { hasNextPage: false },
            },
        };
        const { reader } = reading({ data: { issue } }, { ok: true, value: [] });
        const result = await reader.read(linearTask);
        expect(result.ok && [result.value.duplicates.length, result.value.related.length]).toEqual([
            1, 1,
        ]);
    });

    it("a missing connection yields an empty list and a note", async () => {
        const { attachments: _attachments, ...issue } = attachment.data.issue;
        const { reader } = reading({ data: { issue } }, { ok: true, value: [] });
        const result = await reader.read(linearTask);
        expect(valueOf(result)).toMatchObject({
            attachments: [],
            notes: ["linear: attachments were not read"],
        });
    });

    it("a full page yields a note instead of a silent cut", async () => {
        const issue = {
            ...empty.data.issue,
            children: { nodes: [], pageInfo: { hasNextPage: true } },
        };
        const { reader } = reading({ data: { issue } }, { ok: true, value: [] });
        const result = await reader.read(linearTask);
        expect(result.ok && result.value.notes).toEqual([
            "linear: children has more than 100 entries, the rest were not read",
        ]);
    });

    it("fails strictly on a shape it does not know", async () => {
        const { reader } = reading({ data: { issue: null } }, { ok: true, value: [] });
        const result = await reader.read(linearTask);
        expect(!result.ok && result.error).toContain("linear api issue --variable id=DEMO-110");
    });
});
