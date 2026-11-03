import { describe, expect, it } from "vitest";

import type { BeadsConfig } from "../../config.ts";
import type { Exec, ExecResult } from "../../exec.ts";
import { beadsTracker } from "./beads.ts";
import comments from "./fixtures/beads-comments.json";

const CONFIG: BeadsConfig = { enabled: true, directory: "/repo/.beads" };

function fakeExec(handler: (args: string[]) => ExecResult): Exec & { calls: string[][] } {
    const calls: string[][] = [];
    const exec = (args: string[]) => {
        calls.push(args);
        return Promise.resolve(handler(args));
    };
    return Object.assign(exec, { calls });
}

const LIST_FIXTURE = [
    {
        id: "agentic-task-kc2.29",
        title: "SECURITY: fix the thing",
        description: "a longer description",
        status: "in_progress",
        priority: 0,
        issue_type: "bug",
        updated_at: "2026-09-24T13:53:15Z",
        labels: ["human", "security", "validation", "zod"],
        dependency_count: 0,
    },
    {
        id: "agentic-task-kc2.30",
        title: "no labels, no description",
        status: "open",
        updated_at: "2026-09-20T10:00:00Z",
    },
];

describe("beadsTracker", () => {
    describe("listTasks", () => {
        it("lists open tasks with the exact argv", async () => {
            const exec = fakeExec(() => ({ ok: true, stdout: JSON.stringify(LIST_FIXTURE) }));
            const tracker = beadsTracker(exec, CONFIG);
            const result = await tracker.listTasks();

            expect(exec.calls).toEqual([
                [
                    "-C",
                    "/repo/.beads",
                    "list",
                    "--json",
                    "--limit",
                    "0",
                    "--status",
                    "open,in_progress",
                ],
            ]);
            expect(result).toEqual({
                ok: true,
                value: [
                    {
                        source: "beads",
                        id: "agentic-task-kc2.29",
                        title: "SECURITY: fix the thing",
                        description: "a longer description",
                        labels: ["human", "security", "validation", "zod"],
                        status: "in_progress",
                        updatedAt: "2026-09-24T13:53:15Z",
                        closed: false,
                    },
                    {
                        source: "beads",
                        id: "agentic-task-kc2.30",
                        title: "no labels, no description",
                        description: "",
                        labels: [],
                        status: "open",
                        updatedAt: "2026-09-20T10:00:00Z",
                        closed: false,
                    },
                ],
            });
        });

        it("filters defensively to open and in_progress even if the CLI returns more", async () => {
            const exec = fakeExec(() => ({
                ok: true,
                stdout: JSON.stringify([
                    ...LIST_FIXTURE,
                    { id: "x", title: "closed one", status: "closed", updated_at: "" },
                ]),
            }));
            const tracker = beadsTracker(exec, CONFIG);
            const result = await tracker.listTasks();

            expect(result.ok && result.value.map((task) => task.id)).toEqual([
                "agentic-task-kc2.29",
                "agentic-task-kc2.30",
            ]);
        });

        it("reports a missing CLI naming the command", async () => {
            const exec = fakeExec(() => ({ ok: false, error: "bd CLI not found on PATH" }));
            const tracker = beadsTracker(exec, CONFIG);
            const result = await tracker.listTasks();

            expect(result).toEqual({
                ok: false,
                error: "bd list --json: bd CLI not found on PATH",
            });
        });

        it("reports a non-zero exit naming the command", async () => {
            const exec = fakeExec(() => ({ ok: false, error: "bd failed: boom" }));
            const tracker = beadsTracker(exec, CONFIG);
            const result = await tracker.listTasks();

            expect(result).toEqual({ ok: false, error: "bd list --json: bd failed: boom" });
        });

        it("reports a timeout naming the command", async () => {
            const exec = fakeExec(() => ({ ok: false, error: "bd timed out after 120 s" }));
            const tracker = beadsTracker(exec, CONFIG);
            const result = await tracker.listTasks();

            expect(result).toEqual({
                ok: false,
                error: "bd list --json: bd timed out after 120 s",
            });
        });

        it("reports invalid JSON naming the command", async () => {
            const exec = fakeExec(() => ({ ok: true, stdout: "not json" }));
            const tracker = beadsTracker(exec, CONFIG);
            const result = await tracker.listTasks();

            expect(result.ok).toBe(false);
            expect(!result.ok && result.error).toMatch(
                /^bd list --json: output is not valid JSON: /,
            );
        });

        it("reports the wrong shape naming the command and the JSON path", async () => {
            const exec = fakeExec(() => ({
                ok: true,
                stdout: JSON.stringify([
                    { id: "x", title: "t", status: "open", updated_at: "", labels: "not-an-array" },
                ]),
            }));
            const tracker = beadsTracker(exec, CONFIG);
            const result = await tracker.listTasks();

            expect(result).toEqual({
                ok: false,
                error: "bd list --json: output does not match the expected shape: $[0].labels must be an array",
            });
        });
    });

    describe("readTask", () => {
        it("reads one task with the exact argv", async () => {
            const exec = fakeExec(() => ({ ok: true, stdout: JSON.stringify([LIST_FIXTURE[0]]) }));
            const tracker = beadsTracker(exec, CONFIG);
            const result = await tracker.readTask("agentic-task-kc2.29");

            expect(exec.calls).toEqual([
                ["-C", "/repo/.beads", "show", "agentic-task-kc2.29", "--json"],
            ]);
            expect(result.ok && result.value.id).toBe("agentic-task-kc2.29");
        });

        it("reads an in-progress task as not closed", async () => {
            const exec = fakeExec(() => ({ ok: true, stdout: JSON.stringify([LIST_FIXTURE[0]]) }));
            const result = await beadsTracker(exec, CONFIG).readTask("agentic-task-kc2.29");

            expect(result.ok && [result.value.status, result.value.closed]).toEqual([
                "in_progress",
                false,
            ]);
        });

        it("reads a task whose status is closed as closed", async () => {
            const closedTask = { id: "x", title: "done", status: "closed", updated_at: "" };
            const exec = fakeExec(() => ({ ok: true, stdout: JSON.stringify([closedTask]) }));
            const result = await beadsTracker(exec, CONFIG).readTask("x");

            expect(result.ok && [result.value.status, result.value.closed]).toEqual([
                "closed",
                true,
            ]);
        });

        it("errors when the array does not hold exactly one element", async () => {
            const exec = fakeExec(() => ({ ok: true, stdout: JSON.stringify(LIST_FIXTURE) }));
            const tracker = beadsTracker(exec, CONFIG);
            const result = await tracker.readTask("agentic-task-kc2.29");

            expect(result.ok).toBe(false);
            expect(!result.ok && result.error).toContain("bd show agentic-task-kc2.29 --json:");
        });
    });

    describe("addLabel", () => {
        it("adds one label with the exact argv", async () => {
            const exec = fakeExec(() => ({ ok: true, stdout: "" }));
            const tracker = beadsTracker(exec, CONFIG);
            const result = await tracker.addLabel("agentic-task-kc2.29", "work");

            expect(exec.calls).toEqual([
                ["-C", "/repo/.beads", "label", "add", "agentic-task-kc2.29", "work"],
            ]);
            expect(result).toEqual({ ok: true, value: undefined });
        });

        it("reports a CLI error naming the command", async () => {
            const exec = fakeExec(() => ({ ok: false, error: "bd failed: boom" }));
            const tracker = beadsTracker(exec, CONFIG);
            const result = await tracker.addLabel("x", "work");

            expect(result).toEqual({ ok: false, error: "bd label add x work: bd failed: boom" });
        });
    });

    describe("removeLabel", () => {
        it("removes one label with the exact argv", async () => {
            const exec = fakeExec(() => ({ ok: true, stdout: "" }));
            const tracker = beadsTracker(exec, CONFIG);
            const result = await tracker.removeLabel("agentic-task-kc2.29", "taken");

            expect(exec.calls).toEqual([
                ["-C", "/repo/.beads", "label", "remove", "agentic-task-kc2.29", "taken"],
            ]);
            expect(result).toEqual({ ok: true, value: undefined });
        });

        it("reports a CLI error naming the command", async () => {
            const exec = fakeExec(() => ({ ok: false, error: "bd failed: boom" }));
            const tracker = beadsTracker(exec, CONFIG);
            const result = await tracker.removeLabel("x", "taken");

            expect(result).toEqual({
                ok: false,
                error: "bd label remove x taken: bd failed: boom",
            });
        });
    });

    describe("updateDescription", () => {
        it("replaces the description from a file with the exact argv", async () => {
            const exec = fakeExec(() => ({ ok: true, stdout: "" }));
            const tracker = beadsTracker(exec, CONFIG);
            const result = await tracker.updateDescription("agentic-task-kc2.29", "/state/a/d.md");

            expect(exec.calls).toEqual([
                [
                    "-C",
                    "/repo/.beads",
                    "update",
                    "agentic-task-kc2.29",
                    "--body-file",
                    "/state/a/d.md",
                ],
            ]);
            expect(result).toEqual({ ok: true, value: undefined });
        });

        it("reports a CLI error naming the command", async () => {
            const exec = fakeExec(() => ({ ok: false, error: "bd failed: boom" }));
            const result = await beadsTracker(exec, CONFIG).updateDescription("x", "/s/d.md");

            expect(result).toEqual({
                ok: false,
                error: "bd update x --body-file /s/d.md: bd failed: boom",
            });
        });
    });

    describe("addComment", () => {
        it("posts the comment from a file with the exact argv", async () => {
            const exec = fakeExec(() => ({ ok: true, stdout: "" }));
            const tracker = beadsTracker(exec, CONFIG);
            const result = await tracker.addComment("agentic-task-kc2.29", "/state/a/c.md");

            expect(exec.calls).toEqual([
                [
                    "-C",
                    "/repo/.beads",
                    "comments",
                    "add",
                    "agentic-task-kc2.29",
                    "-f",
                    "/state/a/c.md",
                ],
            ]);
            expect(result).toEqual({ ok: true, value: undefined });
        });

        it("reports a CLI error naming the command", async () => {
            const exec = fakeExec(() => ({ ok: false, error: "bd failed: boom" }));
            const result = await beadsTracker(exec, CONFIG).addComment("x", "/s/c.md");

            expect(result).toEqual({
                ok: false,
                error: "bd comments add x -f /s/c.md: bd failed: boom",
            });
        });
    });

    describe("readComments", () => {
        it("reads a recorded comment listing into bodies with the exact argv", async () => {
            const exec = fakeExec(() => ({ ok: true, stdout: JSON.stringify(comments) }));
            const result = await beadsTracker(exec, CONFIG).readComments("agentic-task-kc2.29");

            expect(exec.calls).toEqual([
                ["-C", "/repo/.beads", "comments", "agentic-task-kc2.29", "--json"],
            ]);
            expect(result).toEqual({
                ok: true,
                value: ["First comment body.", "Second comment body.\n\nWith a second paragraph."],
            });
        });

        it("returns the bodies oldest first whatever order the CLI prints them in", async () => {
            const exec = fakeExec(() => ({
                ok: true,
                stdout: JSON.stringify([...comments].reverse()),
            }));
            const result = await beadsTracker(exec, CONFIG).readComments("x");

            expect(result.ok && result.value[0]).toBe("First comment body.");
        });

        it("reads a task without comments as an empty list", async () => {
            const exec = fakeExec(() => ({ ok: true, stdout: "[]" }));
            const result = await beadsTracker(exec, CONFIG).readComments("x");

            expect(result).toEqual({ ok: true, value: [] });
        });

        it("reports a CLI error naming the command", async () => {
            const exec = fakeExec(() => ({ ok: false, error: "bd failed: boom" }));
            const result = await beadsTracker(exec, CONFIG).readComments("x");

            expect(result).toEqual({ ok: false, error: "bd comments x --json: bd failed: boom" });
        });

        it("reports the wrong shape naming the command and the JSON path", async () => {
            const exec = fakeExec(() => ({
                ok: true,
                stdout: JSON.stringify([{ created_at: "2026-01-01T10:00:00Z" }]),
            }));
            const result = await beadsTracker(exec, CONFIG).readComments("x");

            expect(result).toEqual({
                ok: false,
                error: "bd comments x --json: output does not match the expected shape: $[0].text must be a string",
            });
        });
    });

    describe("listLabels", () => {
        it("lists all labels with the exact argv", async () => {
            const exec = fakeExec(() => ({
                ok: true,
                stdout: JSON.stringify([
                    { label: "work", count: 12 },
                    { label: "security", count: 3 },
                ]),
            }));
            const tracker = beadsTracker(exec, CONFIG);
            const result = await tracker.listLabels();

            expect(exec.calls).toEqual([["-C", "/repo/.beads", "label", "list-all", "--json"]]);
            expect(result).toEqual({
                ok: true,
                value: [
                    { scope: "beads", name: "work", colour: null },
                    { scope: "beads", name: "security", colour: null },
                ],
            });
        });
    });

    describe("createLabel", () => {
        it("always refuses: beads needs no label creation", async () => {
            const exec = fakeExec(() => ({ ok: true, stdout: "" }));
            const tracker = beadsTracker(exec, CONFIG);
            const result = await tracker.createLabel("beads", "work", "#2f80ed");

            expect(exec.calls).toEqual([]);
            expect(result).toEqual({
                ok: false,
                error: "Beads needs no label creation: labels exist by use",
            });
        });
    });

    describe("recolourLabel", () => {
        it("always refuses: beads has no label colours", async () => {
            const exec = fakeExec(() => ({ ok: true, stdout: "" }));
            const tracker = beadsTracker(exec, CONFIG);
            const result = await tracker.recolourLabel(
                { scope: "beads", name: "work", colour: null },
                "#2f80ed",
            );

            expect(exec.calls).toEqual([]);
            expect(result).toEqual({ ok: false, error: "Beads has no label colours" });
        });
    });

    describe("tracker shape", () => {
        it("declares no label scopes and no label creation", () => {
            const tracker = beadsTracker(
                fakeExec(() => ({ ok: true, stdout: "" })),
                CONFIG,
            );
            expect(tracker.source).toBe("beads");
            expect(tracker.labelScopes).toEqual([]);
            expect(tracker.createsLabels).toBe(false);
        });
    });
});
