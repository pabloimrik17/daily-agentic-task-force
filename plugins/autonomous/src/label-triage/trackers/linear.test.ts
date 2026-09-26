import { describe, expect, it } from "vitest";

import type { LinearConfig } from "../../config.ts";
import type { Exec, ExecResult } from "../../exec.ts";
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
        it("reads one issue with the exact argv, description and no guaranteed updatedAt", async () => {
            const exec = fakeExec(() => ({
                ok: true,
                stdout: JSON.stringify({
                    identifier: "DOT-82",
                    title: "some task",
                    description: "the body",
                    state: { name: "Triage", color: "#000" },
                    labels: { nodes: [{ name: "bug", color: "#eb5757" }] },
                }),
            }));
            const tracker = linearTracker(exec, CONFIG);
            const result = await tracker.readTask("DOT-82");

            expect(exec.calls).toEqual([["issue", "view", "DOT-82", "--json"]]);
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
                },
            });
        });

        it("allows a null description", async () => {
            const exec = fakeExec(() => ({
                ok: true,
                stdout: JSON.stringify({
                    identifier: "DOT-82",
                    title: "some task",
                    description: null,
                    state: { name: "Triage", color: "#000" },
                    labels: { nodes: [] },
                }),
            }));
            const tracker = linearTracker(exec, CONFIG);
            const result = await tracker.readTask("DOT-82");

            expect(result.ok && result.value.description).toBeNull();
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
                    { scope: "workspace", name: "AFK", colour: "#5e6ad2" },
                    { scope: "DOT", name: "bug", colour: "#eb5757" },
                ],
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
