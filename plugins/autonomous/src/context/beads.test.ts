import { describe, expect, it } from "vitest";
import { beadsContext } from "./beads.ts";
import empty from "./fixtures/beads-show-empty.json";
import parentFixture from "./fixtures/beads-show-parent.json";
import task from "./fixtures/beads-show-task.json";
import { beadsTask, execFailing, execPrinting, valueOf } from "./test-fixtures.ts";

const CONFIG = { enabled: true, directory: "/repo" };

describe("beadsContext", () => {
    it("Task after a grill: reads comments in order, the parent with its description and the blockers without theirs", async () => {
        const exec = execPrinting([task]);
        const result = await beadsContext(exec, CONFIG).read(beadsTask);
        expect(valueOf(result)).toMatchObject({
            comments: ["First synthetic comment.", "Second synthetic comment."],
            parent: {
                id: "demo-1",
                title: "Synthetic parent",
                state: "open",
                url: null,
                description: "Synthetic parent description.",
            },
            blockedBy: [
                { id: "demo-1.2", title: "Synthetic blocker", state: "closed", url: null },
                {
                    id: "demo-1.6",
                    title: "Synthetic open blocker",
                    state: "in_progress",
                    url: null,
                },
            ],
            blocks: [
                { id: "demo-1.8", title: "Synthetic dependent task", state: "open", url: null },
            ],
            related: [{ id: "demo-1.9" }],
            notes: [],
        });
        expect(exec).toHaveBeenCalledWith([
            "-C",
            "/repo",
            "show",
            "demo-1.7",
            "--json",
            "--include-comments",
            "--include-dependents",
        ]);
    });

    it("reads the children of a parent and its related task", async () => {
        const result = await beadsContext(execPrinting([parentFixture]), CONFIG).read(beadsTask);
        expect(result.ok && result.value.children.map(({ id, state }) => [id, state])).toEqual([
            ["demo-2.1", "closed"],
            ["demo-2.2", "open"],
        ]);
        expect(result.ok && result.value.related.map(({ id }) => id)).toEqual(["demo-7"]);
        expect(result.ok && result.value.parent).toBeNull();
    });

    it("Task with no relations: bd omits the lists, so the context holds none and no note", async () => {
        const result = await beadsContext(execPrinting([empty]), CONFIG).read(beadsTask);
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

    it("Tracker read fails: names the command", async () => {
        const result = await beadsContext(execFailing("bd failed: boom"), CONFIG).read(beadsTask);
        expect(result).toEqual({
            ok: false,
            error: "bd show demo-1.7 --json --include-comments --include-dependents: bd failed: boom",
        });
    });

    it("fails strictly on a mistyped list", async () => {
        const result = await beadsContext(
            execPrinting([{ ...task, dependencies: "none" }]),
            CONFIG,
        ).read(beadsTask);
        expect(!result.ok && result.error).toContain("$[0].dependencies must be an array");
    });
});
