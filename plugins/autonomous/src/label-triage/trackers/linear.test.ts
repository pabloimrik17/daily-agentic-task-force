import { describe, expect, it } from "vitest";

import type { LinearConfig } from "../../config.ts";
import type { Exec, ExecResult } from "../../exec.ts";
import comments from "./fixtures/linear-comments.json";
import { linearTracker } from "./linear.ts";

const CONFIG: LinearConfig = { enabled: true };

function fakeExec(handler: (args: string[]) => ExecResult): Exec & { calls: string[][] } {
    const calls: string[][] = [];
    const exec = (args: string[]) => {
        calls.push(args);
        return Promise.resolve(handler(args));
    };
    return Object.assign(exec, { calls });
}

function node(
    overrides: Partial<{ identifier: string; title: string; stateName: string; stateType: string }>,
) {
    return {
        identifier: overrides.identifier ?? "DOT-82",
        title: overrides.title ?? "some task",
        updatedAt: "2026-09-20T13:29:02Z",
        state: {
            id: "s1",
            name: overrides.stateName ?? "Triage",
            color: "#000",
            type: overrides.stateType ?? "triage",
            position: 0,
        },
        labels: { nodes: [{ name: "bug", color: "#eb5757" }] },
    };
}

describe("linearTracker", () => {
    describe("listTasks", () => {
        it("lists issues across all teams with the exact argv", async () => {
            const exec = fakeExec(() => ({
                ok: true,
                stdout: JSON.stringify({ nodes: [node({})], pageInfo: {} }),
            }));
            const tracker = linearTracker(exec, CONFIG);
            const result = await tracker.listTasks();

            expect(exec.calls).toEqual([
                ["issue", "query", "--all-teams", "--limit", "0", "--json"],
            ]);
            expect(result).toEqual({
                ok: true,
                value: [
                    {
                        source: "linear",
                        id: "DOT-82",
                        title: "some task",
                        description: null,
                        labels: ["bug"],
                        status: "Triage",
                        updatedAt: "2026-09-20T13:29:02Z",
                        closed: false,
                    },
                ],
            });
        });

        it("drops completed, canceled and Duplicate issues, keeping the rest", async () => {
            const exec = fakeExec(() => ({
                ok: true,
                stdout: JSON.stringify({
                    nodes: [
                        node({ identifier: "DOT-1", stateName: "Done", stateType: "completed" }),
                        node({ identifier: "DOT-2", stateName: "Canceled", stateType: "canceled" }),
                        node({
                            identifier: "DOT-3",
                            stateName: "Duplicate",
                            stateType: "unstarted",
                        }),
                        node({ identifier: "DOT-4", stateName: "duplicate", stateType: "backlog" }),
                        node({ identifier: "DOT-5", stateName: "Triage", stateType: "triage" }),
                        node({ identifier: "DOT-6", stateName: "Backlog", stateType: "backlog" }),
                        node({
                            identifier: "DOT-7",
                            stateName: "In Progress",
                            stateType: "started",
                        }),
                    ],
                    pageInfo: {},
                }),
            }));
            const tracker = linearTracker(exec, CONFIG);
            const result = await tracker.listTasks();

            expect(result.ok && result.value.map((task) => task.id)).toEqual([
                "DOT-5",
                "DOT-6",
                "DOT-7",
            ]);
        });

        it("reports the unauthenticated case naming Linear and linear auth login", async () => {
            const exec = fakeExec(() => ({
                ok: false,
                error: "linear failed: No API key configured. Set LINEAR_API_KEY, add api_key to .linear.toml, or run `linear auth login`.",
            }));
            const tracker = linearTracker(exec, CONFIG);
            const result = await tracker.listTasks();

            expect(result).toEqual({
                ok: false,
                error: "linear issue query --all-teams: Linear CLI is not authenticated, run `linear auth login`",
            });
        });

        it("reports a missing CLI naming the command", async () => {
            const exec = fakeExec(() => ({ ok: false, error: "linear CLI not found on PATH" }));
            const tracker = linearTracker(exec, CONFIG);
            const result = await tracker.listTasks();

            expect(result).toEqual({
                ok: false,
                error: "linear issue query --all-teams: linear CLI not found on PATH",
            });
        });

        it("reports a timeout naming the command", async () => {
            const exec = fakeExec(() => ({ ok: false, error: "linear timed out after 120 s" }));
            const tracker = linearTracker(exec, CONFIG);
            const result = await tracker.listTasks();

            expect(result).toEqual({
                ok: false,
                error: "linear issue query --all-teams: linear timed out after 120 s",
            });
        });

        it("reports invalid JSON naming the command", async () => {
            const exec = fakeExec(() => ({ ok: true, stdout: "not json" }));
            const tracker = linearTracker(exec, CONFIG);
            const result = await tracker.listTasks();

            expect(result.ok).toBe(false);
            expect(!result.ok && result.error).toMatch(
                /^linear issue query --all-teams: output is not valid JSON: /,
            );
        });

        it("reports the wrong shape naming the command and the JSON path", async () => {
            const exec = fakeExec(() => ({
                ok: true,
                stdout: JSON.stringify({ nodes: "not-an-array" }),
            }));
            const tracker = linearTracker(exec, CONFIG);
            const result = await tracker.listTasks();

            expect(result).toEqual({
                ok: false,
                error: "linear issue query --all-teams: output does not match the expected shape: $.nodes must be an array",
            });
        });
    });

    describe("readTask", () => {
        const VIEW = {
            identifier: "DOT-82",
            title: "some task",
            description: "the body",
            state: { name: "Triage", color: "#000" },
            labels: { nodes: [{ name: "bug", color: "#eb5757" }] },
        };

        function typeReply(type: string): string {
            return JSON.stringify({ data: { issue: { state: { type } } } });
        }

        function readExec(view: unknown, type: string) {
            return fakeExec((args) => ({
                ok: true,
                stdout: args[0] === "api" ? typeReply(type) : JSON.stringify(view),
            }));
        }

        it("reads one issue with the view, then the state type, with the exact argv", async () => {
            const exec = readExec(VIEW, "triage");
            const tracker = linearTracker(exec, CONFIG);
            const result = await tracker.readTask("DOT-82");

            expect(exec.calls).toEqual([
                ["issue", "view", "DOT-82", "--no-comments", "--json"],
                [
                    "api",
                    "query($id: String!) { issue(id: $id) { state { type } } }",
                    "--variable",
                    "id=DOT-82",
                ],
            ]);
            expect(result).toEqual({
                ok: true,
                value: {
                    source: "linear",
                    id: "DOT-82",
                    title: "some task",
                    description: "the body",
                    labels: ["bug"],
                    status: "Triage",
                    updatedAt: "",
                    closed: false,
                },
            });
        });

        it.each([
            ["an open task", { name: "In Progress", color: "#000" }, "started", false],
            ["a task in Done", { name: "Done", color: "#000" }, "completed", true],
            ["a task in Canceled", { name: "Canceled", color: "#000" }, "canceled", true],
            ["a task in Duplicate", { name: "Duplicate", color: "#000" }, "canceled", true],
            [
                "a task in Duplicate that is not canceled",
                { name: "Duplicate", color: "#000" },
                "unstarted",
                true,
            ],
            ["a task in duplicate, whatever the case", { name: "duplicate" }, "backlog", true],
            ["a task in Triage", { name: "Triage", color: "#000" }, "triage", false],
        ])("reads %s: closed is %s", async (_label, state, type, closed) => {
            const exec = readExec({ ...VIEW, state }, type);
            const result = await linearTracker(exec, CONFIG).readTask("DOT-82");

            expect(result.ok && result.value.closed).toBe(closed);
        });

        it("allows a null description", async () => {
            const exec = readExec({ ...VIEW, description: null }, "triage");
            const tracker = linearTracker(exec, CONFIG);
            const result = await tracker.readTask("DOT-82");

            expect(result.ok && result.value.description).toBeNull();
        });

        it("fails naming the view command and skips the state type", async () => {
            const exec = fakeExec(() => ({ ok: false, error: "linear failed: boom" }));
            const result = await linearTracker(exec, CONFIG).readTask("DOT-82");

            expect(exec.calls).toHaveLength(1);
            expect(result).toEqual({
                ok: false,
                error: "linear issue view DOT-82: linear failed: boom",
            });
        });

        it("fails naming the api command when the state type call exits non-zero", async () => {
            const exec = fakeExec((args) =>
                args[0] === "api"
                    ? { ok: false, error: "linear failed: boom" }
                    : { ok: true, stdout: JSON.stringify(VIEW) },
            );
            const result = await linearTracker(exec, CONFIG).readTask("DOT-82");

            expect(result).toEqual({
                ok: false,
                error: "linear api issue --variable id=DOT-82: linear failed: boom",
            });
        });

        it("reports the unauthenticated case from the api call", async () => {
            const exec = fakeExec((args) =>
                args[0] === "api"
                    ? { ok: false, error: "linear failed: No API key configured." }
                    : { ok: true, stdout: JSON.stringify(VIEW) },
            );
            const result = await linearTracker(exec, CONFIG).readTask("DOT-82");

            expect(result).toEqual({
                ok: false,
                error: "linear api issue --variable id=DOT-82: Linear CLI is not authenticated, run `linear auth login`",
            });
        });

        it.each([
            ["output that is not JSON", "not json", /^output is not valid JSON: /],
            [
                "an issue that is null",
                JSON.stringify({ data: { issue: null } }),
                /^output does not match the expected shape: \$\.data\.issue must be an object/,
            ],
            [
                "a state without a type",
                JSON.stringify({ data: { issue: { state: {} } } }),
                /^output does not match the expected shape: \$\.data\.issue\.state\.type/,
            ],
            [
                "a type that is not a string",
                JSON.stringify({ data: { issue: { state: { type: 3 } } } }),
                /^output does not match the expected shape: \$\.data\.issue\.state\.type/,
            ],
        ])("fails naming the api command for %s", async (_label, stdout, message) => {
            const exec = fakeExec((args) => ({
                ok: true,
                stdout: args[0] === "api" ? stdout : JSON.stringify(VIEW),
            }));
            const result = await linearTracker(exec, CONFIG).readTask("DOT-82");

            const prefix = "linear api issue --variable id=DOT-82: ";
            expect(!result.ok && result.error.startsWith(prefix)).toBe(true);
            expect(!result.ok && result.error.slice(prefix.length)).toMatch(message);
        });
    });

    describe("addLabel", () => {
        it("adds one label incrementally with the exact argv", async () => {
            const exec = fakeExec(() => ({ ok: true, stdout: "" }));
            const tracker = linearTracker(exec, CONFIG);
            const result = await tracker.addLabel("DOT-82", "work");

            expect(exec.calls).toEqual([["issue", "update", "DOT-82", "--add-label", "work"]]);
            expect(result).toEqual({ ok: true, value: undefined });
        });

        it("maps the unauthenticated case naming linear auth login", async () => {
            const exec = fakeExec(() => ({
                ok: false,
                error: "linear failed: Run `linear auth login` to authenticate.",
            }));
            const tracker = linearTracker(exec, CONFIG);
            const result = await tracker.addLabel("DOT-82", "work");

            expect(result).toEqual({
                ok: false,
                error: "linear issue update DOT-82 --add-label work: Linear CLI is not authenticated, run `linear auth login`",
            });
        });
    });

    describe("removeLabel", () => {
        it("removes one label incrementally with the exact argv", async () => {
            const exec = fakeExec(() => ({ ok: true, stdout: "" }));
            const tracker = linearTracker(exec, CONFIG);
            const result = await tracker.removeLabel("DOT-82", "taken");

            expect(exec.calls).toEqual([["issue", "update", "DOT-82", "--remove-label", "taken"]]);
            expect(result).toEqual({ ok: true, value: undefined });
        });

        it("maps the unauthenticated case naming linear auth login", async () => {
            const exec = fakeExec(() => ({
                ok: false,
                error: "linear failed: Run `linear auth login` to authenticate.",
            }));
            const tracker = linearTracker(exec, CONFIG);
            const result = await tracker.removeLabel("DOT-82", "taken");

            expect(result).toEqual({
                ok: false,
                error: "linear issue update DOT-82 --remove-label taken: Linear CLI is not authenticated, run `linear auth login`",
            });
        });
    });

    describe("updateDescription", () => {
        it("replaces the description from a file with the exact argv", async () => {
            const exec = fakeExec(() => ({ ok: true, stdout: "" }));
            const tracker = linearTracker(exec, CONFIG);
            const result = await tracker.updateDescription("DOT-82", "/state/a/d.md");

            expect(exec.calls).toEqual([
                ["issue", "update", "DOT-82", "--description-file", "/state/a/d.md"],
            ]);
            expect(result).toEqual({ ok: true, value: undefined });
        });

        it("maps the unauthenticated case naming linear auth login", async () => {
            const exec = fakeExec(() => ({
                ok: false,
                error: "linear failed: Run `linear auth login` to authenticate.",
            }));
            const result = await linearTracker(exec, CONFIG).updateDescription("DOT-82", "/s/d.md");

            expect(result).toEqual({
                ok: false,
                error: "linear issue update DOT-82 --description-file /s/d.md: Linear CLI is not authenticated, run `linear auth login`",
            });
        });

        it("reports a CLI error naming the command", async () => {
            const exec = fakeExec(() => ({ ok: false, error: "linear failed: boom" }));
            const result = await linearTracker(exec, CONFIG).updateDescription("DOT-82", "/s/d.md");

            expect(result).toEqual({
                ok: false,
                error: "linear issue update DOT-82 --description-file /s/d.md: linear failed: boom",
            });
        });
    });

    describe("addComment", () => {
        it("posts the comment from a file with the exact argv", async () => {
            const exec = fakeExec(() => ({ ok: true, stdout: "" }));
            const tracker = linearTracker(exec, CONFIG);
            const result = await tracker.addComment("DOT-82", "/state/a/c.md");

            expect(exec.calls).toEqual([
                ["issue", "comment", "add", "DOT-82", "--body-file", "/state/a/c.md"],
            ]);
            expect(result).toEqual({ ok: true, value: undefined });
        });

        it("reports a CLI error naming the command", async () => {
            const exec = fakeExec(() => ({ ok: false, error: "linear failed: boom" }));
            const result = await linearTracker(exec, CONFIG).addComment("DOT-82", "/s/c.md");

            expect(result).toEqual({
                ok: false,
                error: "linear issue comment add DOT-82 --body-file /s/c.md: linear failed: boom",
            });
        });
    });

    describe("readComments", () => {
        it("reads a recorded comment listing into bodies with the exact argv", async () => {
            const exec = fakeExec(() => ({ ok: true, stdout: JSON.stringify(comments) }));
            const result = await linearTracker(exec, CONFIG).readComments("DOT-82");

            expect(exec.calls).toEqual([["issue", "comment", "list", "DOT-82", "--json"]]);
            expect(result).toEqual({
                ok: true,
                value: ["First comment body.", "Second comment body.\n\nWith a second paragraph."],
            });
        });

        it("returns the bodies oldest first whatever order the CLI prints them in", async () => {
            const exec = fakeExec(() => ({
                ok: true,
                stdout: JSON.stringify({ ...comments, nodes: [...comments.nodes].reverse() }),
            }));
            const result = await linearTracker(exec, CONFIG).readComments("DOT-82");

            expect(result.ok && result.value[0]).toBe("First comment body.");
        });

        it("reads an issue without comments as an empty list", async () => {
            const exec = fakeExec(() => ({
                ok: true,
                stdout: JSON.stringify({
                    nodes: [],
                    pageInfo: { hasNextPage: false, endCursor: null },
                }),
            }));
            const result = await linearTracker(exec, CONFIG).readComments("DOT-82");

            expect(result).toEqual({ ok: true, value: [] });
        });

        it("fails rather than return a partial listing when another page exists", async () => {
            const exec = fakeExec(() => ({
                ok: true,
                stdout: JSON.stringify({
                    ...comments,
                    pageInfo: { hasNextPage: true, endCursor: "next" },
                }),
            }));
            const result = await linearTracker(exec, CONFIG).readComments("DOT-82");

            expect(result).toEqual({
                ok: false,
                error: "linear issue comment list DOT-82: more than one page of comments; the listing would be incomplete",
            });
        });

        it("maps the unauthenticated case naming linear auth login", async () => {
            const exec = fakeExec(() => ({
                ok: false,
                error: "linear failed: Run `linear auth login` to authenticate.",
            }));
            const result = await linearTracker(exec, CONFIG).readComments("DOT-82");

            expect(result).toEqual({
                ok: false,
                error: "linear issue comment list DOT-82: Linear CLI is not authenticated, run `linear auth login`",
            });
        });

        it("reports the wrong shape naming the command and the JSON path", async () => {
            const exec = fakeExec(() => ({
                ok: true,
                stdout: JSON.stringify({
                    nodes: [{ createdAt: "x" }],
                    pageInfo: { hasNextPage: false },
                }),
            }));
            const result = await linearTracker(exec, CONFIG).readComments("DOT-82");

            expect(result).toEqual({
                ok: false,
                error: "linear issue comment list DOT-82: output does not match the expected shape: $.nodes[0].body must be a string",
            });
        });
    });

    describe("listLabels", () => {
        it("lists labels with the exact argv, workspace and team scopes", async () => {
            const exec = fakeExec(() => ({
                ok: true,
                stdout: JSON.stringify({
                    nodes: [
                        { id: "l1", name: "AFK", description: "", color: "#5E6AD2", team: null },
                        {
                            id: "l2",
                            name: "bug",
                            description: "",
                            color: "#EB5757",
                            team: { key: "DOT", name: "Dot" },
                        },
                    ],
                    pageInfo: {},
                }),
            }));
            const tracker = linearTracker(exec, CONFIG);
            const result = await tracker.listLabels();

            expect(exec.calls).toEqual([["label", "list", "--all", "--json"]]);
            expect(result).toEqual({
                ok: true,
                value: [
                    { scope: "workspace", name: "AFK", colour: "#5e6ad2", id: "l1" },
                    { scope: "DOT", name: "bug", colour: "#eb5757", id: "l2" },
                ],
            });
        });

        it("fills the id of a workspace label and of a team label", async () => {
            const exec = fakeExec(() => ({
                ok: true,
                stdout: JSON.stringify({
                    nodes: [
                        { id: "uuid-1", name: "AFK", color: "#5e6ad2", team: null },
                        { id: "uuid-2", name: "AFK", color: "#5e6ad2", team: { key: "DOT" } },
                    ],
                }),
            }));
            const result = await linearTracker(exec, CONFIG).listLabels();

            expect(result.ok && result.value.map((label) => label.id)).toEqual([
                "uuid-1",
                "uuid-2",
            ]);
        });

        it("leaves the id absent when the listing carries none", async () => {
            const exec = fakeExec(() => ({
                ok: true,
                stdout: JSON.stringify({
                    nodes: [{ name: "AFK", color: "#5e6ad2", team: null }],
                }),
            }));
            const result = await linearTracker(exec, CONFIG).listLabels();

            expect(result).toEqual({
                ok: true,
                value: [{ scope: "workspace", name: "AFK", colour: "#5e6ad2" }],
            });
        });

        it("reports an id that is not a string, naming the JSON path", async () => {
            const exec = fakeExec(() => ({
                ok: true,
                stdout: JSON.stringify({
                    nodes: [{ id: 7, name: "AFK", color: "#5e6ad2", team: null }],
                }),
            }));
            const result = await linearTracker(exec, CONFIG).listLabels();

            expect(result).toEqual({
                ok: false,
                error: "linear label list --all: output does not match the expected shape: $.nodes[0].id must be a string",
            });
        });
    });

    describe("createLabel", () => {
        it("creates a workspace label with the exact argv", async () => {
            const exec = fakeExec(() => ({ ok: true, stdout: "" }));
            const tracker = linearTracker(exec, CONFIG);
            const result = await tracker.createLabel("workspace", "work", "#2f80ed");

            expect(exec.calls).toEqual([["label", "create", "-n", "work", "-c", "#2f80ed"]]);
            expect(result).toEqual({ ok: true, value: undefined });
        });

        it("rejects a scope other than workspace without calling the CLI", async () => {
            const exec = fakeExec(() => ({ ok: true, stdout: "" }));
            const tracker = linearTracker(exec, CONFIG);
            const result = await tracker.createLabel("DOT", "work", "#2f80ed");

            expect(exec.calls).toEqual([]);
            expect(result.ok).toBe(false);
            expect(!result.ok && result.error).toContain('scope "DOT"');
        });
    });

    describe("recolourLabel", () => {
        const LABEL = { scope: "workspace", name: "AFK", colour: "#000000", id: "uuid-1" };
        const MUTATION =
            "mutation($id: String!, $color: String!) { issueLabelUpdate(id: $id, input: { color: $color }) { success } }";
        const COMMAND = "linear api issueLabelUpdate --variable id=uuid-1 --variable color=#5e6ad2";

        it("updates the colour through linear api with the exact argv, keeping the #", async () => {
            const exec = fakeExec(() => ({
                ok: true,
                stdout: JSON.stringify({ data: { issueLabelUpdate: { success: true } } }),
            }));
            const result = await linearTracker(exec, CONFIG).recolourLabel(LABEL, "#5e6ad2");

            expect(exec.calls).toEqual([
                ["api", MUTATION, "--variable", "id=uuid-1", "--variable", "color=#5e6ad2"],
            ]);
            expect(result).toEqual({ ok: true, value: undefined });
        });

        it("recolours a team label by its id as well", async () => {
            const exec = fakeExec(() => ({
                ok: true,
                stdout: JSON.stringify({ data: { issueLabelUpdate: { success: true } } }),
            }));
            const result = await linearTracker(exec, CONFIG).recolourLabel(
                { ...LABEL, scope: "DOT", id: "uuid-2" },
                "#eb5757",
            );

            expect(exec.calls[0]?.slice(2)).toEqual([
                "--variable",
                "id=uuid-2",
                "--variable",
                "color=#eb5757",
            ]);
            expect(result).toEqual({ ok: true, value: undefined });
        });

        it("fails when the response reports success false", async () => {
            const exec = fakeExec(() => ({
                ok: true,
                stdout: JSON.stringify({ data: { issueLabelUpdate: { success: false } } }),
            }));
            const result = await linearTracker(exec, CONFIG).recolourLabel(LABEL, "#5e6ad2");

            expect(result).toEqual({
                ok: false,
                error: `${COMMAND}: Linear did not report success`,
            });
        });

        it("fails when the response carries no mutation result, naming the JSON path", async () => {
            const exec = fakeExec(() => ({
                ok: true,
                stdout: JSON.stringify({ errors: [{ message: "Entity not found" }], data: null }),
            }));
            const result = await linearTracker(exec, CONFIG).recolourLabel(LABEL, "#5e6ad2");

            expect(result).toEqual({
                ok: false,
                error: `${COMMAND}: output does not match the expected shape: $.data must be an object`,
            });
        });

        it("fails when the response is not valid JSON, naming the command", async () => {
            const exec = fakeExec(() => ({ ok: true, stdout: "not json" }));
            const result = await linearTracker(exec, CONFIG).recolourLabel(LABEL, "#5e6ad2");

            expect(result.ok).toBe(false);
            expect(!result.ok && result.error).toMatch(
                new RegExp(`^${COMMAND}: output is not valid JSON: `),
            );
        });

        it("fails without running anything when the label has no id", async () => {
            const exec = fakeExec(() => ({ ok: true, stdout: "{}" }));
            const result = await linearTracker(exec, CONFIG).recolourLabel(
                { scope: "workspace", name: "AFK", colour: "#000000" },
                "#5e6ad2",
            );

            expect(exec.calls).toEqual([]);
            expect(result).toEqual({
                ok: false,
                error: "linear api issueLabelUpdate: label AFK (scope workspace) has no id",
            });
        });

        it("maps the unauthenticated case naming linear auth login", async () => {
            const exec = fakeExec(() => ({
                ok: false,
                error: "linear failed: Run `linear auth login` to authenticate.",
            }));
            const result = await linearTracker(exec, CONFIG).recolourLabel(LABEL, "#5e6ad2");

            expect(result).toEqual({
                ok: false,
                error: `${COMMAND}: Linear CLI is not authenticated, run \`linear auth login\``,
            });
        });

        it("reports a CLI error naming the command", async () => {
            const exec = fakeExec(() => ({ ok: false, error: "linear failed: boom" }));
            const result = await linearTracker(exec, CONFIG).recolourLabel(LABEL, "#5e6ad2");

            expect(result).toEqual({ ok: false, error: `${COMMAND}: linear failed: boom` });
        });
    });

    describe("tracker shape", () => {
        it("declares the workspace label scope and label creation", () => {
            const tracker = linearTracker(
                fakeExec(() => ({ ok: true, stdout: "" })),
                CONFIG,
            );
            expect(tracker.source).toBe("linear");
            expect(tracker.labelScopes).toEqual(["workspace"]);
            expect(tracker.createsLabels).toBe(true);
        });
    });
});
