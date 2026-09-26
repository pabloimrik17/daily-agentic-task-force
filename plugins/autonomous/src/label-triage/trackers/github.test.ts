import { describe, expect, it } from "vitest";

import type { GithubConfig } from "../../config.ts";
import type { Exec, ExecResult } from "../../exec.ts";
import { githubTracker } from "./github.ts";

const CONFIG: GithubConfig = { enabled: true, repos: ["pabloimrik17/monolab"] };
const MULTI_CONFIG: GithubConfig = {
    enabled: true,
    repos: ["pabloimrik17/monolab", "pabloimrik17/other"],
};

function fakeExec(handler: (args: string[]) => ExecResult): Exec & { calls: string[][] } {
    const calls: string[][] = [];
    const exec = (args: string[]) => {
        calls.push(args);
        return Promise.resolve(handler(args));
    };
    return Object.assign(exec, { calls });
}

const ISSUE_FIXTURE = {
    body: "a longer description",
    labels: [{ id: "LA_1", name: "bug", description: "…", color: "d73a4a" }],
    number: 296,
    state: "OPEN",
    title: "oxfmt: fix things",
    updatedAt: "2026-09-20T13:29:02Z",
};

describe("githubTracker", () => {
    describe("listTasks", () => {
        it("lists open issues for one repo with the exact argv", async () => {
            const exec = fakeExec(() => ({ ok: true, stdout: JSON.stringify([ISSUE_FIXTURE]) }));
            const tracker = githubTracker(exec, CONFIG);
            const result = await tracker.listTasks();

            expect(exec.calls).toEqual([
                [
                    "issue",
                    "list",
                    "--repo",
                    "pabloimrik17/monolab",
                    "--state",
                    "open",
                    "--limit",
                    "1001",
                    "--json",
                    "number,title,body,labels,updatedAt,state",
                ],
            ]);
            expect(result).toEqual({
                ok: true,
                value: [
                    {
                        source: "github",
                        id: "pabloimrik17/monolab#296",
                        title: "oxfmt: fix things",
                        description: "a longer description",
                        labels: ["bug"],
                        status: "OPEN",
                        updatedAt: "2026-09-20T13:29:02Z",
                    },
                ],
            });
        });

        it("lists across multiple repos in order, recording argv per call", async () => {
            const exec = fakeExec((args) => {
                const repo = args[args.indexOf("--repo") + 1];
                return {
                    ok: true,
                    stdout: JSON.stringify([
                        { ...ISSUE_FIXTURE, number: repo === "pabloimrik17/monolab" ? 1 : 2 },
                    ]),
                };
            });
            const tracker = githubTracker(exec, MULTI_CONFIG);
            const result = await tracker.listTasks();

            expect(exec.calls).toHaveLength(2);
            expect(exec.calls[0]).toContain("pabloimrik17/monolab");
            expect(exec.calls[1]).toContain("pabloimrik17/other");
            expect(result.ok && result.value.map((task) => task.id)).toEqual([
                "pabloimrik17/monolab#1",
                "pabloimrik17/other#2",
            ]);
        });

        it("stops at the first repo that fails, naming the command and repo", async () => {
            const exec = fakeExec((args) => {
                const repo = args[args.indexOf("--repo") + 1];
                if (repo === "pabloimrik17/monolab") {
                    return { ok: true, stdout: JSON.stringify([ISSUE_FIXTURE]) };
                }
                return { ok: false, error: "gh failed: boom" };
            });
            const tracker = githubTracker(exec, MULTI_CONFIG);
            const result = await tracker.listTasks();

            expect(result).toEqual({
                ok: false,
                error: "gh issue list --repo pabloimrik17/other --state open --json number,title,body,labels,updatedAt,state: gh failed: boom",
            });
        });

        it("reports a missing CLI naming the command", async () => {
            const exec = fakeExec(() => ({ ok: false, error: "gh CLI not found on PATH" }));
            const tracker = githubTracker(exec, CONFIG);
            const result = await tracker.listTasks();

            expect(result).toEqual({
                ok: false,
                error: "gh issue list --repo pabloimrik17/monolab --state open --json number,title,body,labels,updatedAt,state: gh CLI not found on PATH",
            });
        });

        it("reports a timeout naming the command", async () => {
            const exec = fakeExec(() => ({ ok: false, error: "gh timed out after 120 s" }));
            const tracker = githubTracker(exec, CONFIG);
            const result = await tracker.listTasks();

            expect(result.ok).toBe(false);
            expect(!result.ok && result.error).toContain("gh timed out after 120 s");
        });

        it("reports invalid JSON naming the command", async () => {
            const exec = fakeExec(() => ({ ok: true, stdout: "not json" }));
            const tracker = githubTracker(exec, CONFIG);
            const result = await tracker.listTasks();

            expect(result.ok).toBe(false);
            expect(!result.ok && result.error).toMatch(
                /^gh issue list --repo pabloimrik17\/monolab --state open --json number,title,body,labels,updatedAt,state: output is not valid JSON: /,
            );
        });

        it("reports the wrong shape naming the command and the JSON path", async () => {
            const exec = fakeExec(() => ({
                ok: true,
                stdout: JSON.stringify([{ ...ISSUE_FIXTURE, labels: "not-an-array" }]),
            }));
            const tracker = githubTracker(exec, CONFIG);
            const result = await tracker.listTasks();

            expect(result).toEqual({
                ok: false,
                error: "gh issue list --repo pabloimrik17/monolab --state open --json number,title,body,labels,updatedAt,state: output does not match the expected shape: $[0].labels must be an array",
            });
        });

        it("reports a listing past the cap as incomplete instead of truncating it", async () => {
            const issues = Array.from({ length: 1001 }, (_, index) => ({
                ...ISSUE_FIXTURE,
                number: index + 1,
            }));
            const exec = fakeExec(() => ({ ok: true, stdout: JSON.stringify(issues) }));
            const tracker = githubTracker(exec, CONFIG);
            const result = await tracker.listTasks();

            expect(result).toEqual({
                ok: false,
                error: "gh issue list --repo pabloimrik17/monolab --state open --json number,title,body,labels,updatedAt,state: more than 1000 results; the listing would be incomplete",
            });
        });
    });

    describe("readTask", () => {
        it("reads one issue with the exact argv", async () => {
            const exec = fakeExec(() => ({ ok: true, stdout: JSON.stringify(ISSUE_FIXTURE) }));
            const tracker = githubTracker(exec, CONFIG);
            const result = await tracker.readTask("pabloimrik17/monolab#296");

            expect(exec.calls).toEqual([
                [
                    "issue",
                    "view",
                    "296",
                    "--repo",
                    "pabloimrik17/monolab",
                    "--json",
                    "number,title,body,labels,updatedAt,state",
                ],
            ]);
            expect(result).toEqual({
                ok: true,
                value: {
                    source: "github",
                    id: "pabloimrik17/monolab#296",
                    title: "oxfmt: fix things",
                    description: "a longer description",
                    labels: ["bug"],
                    status: "OPEN",
                    updatedAt: "2026-09-20T13:29:02Z",
                },
            });
        });

        it("errors on a malformed id", async () => {
            const exec = fakeExec(() => ({ ok: true, stdout: "{}" }));
            const tracker = githubTracker(exec, CONFIG);
            const result = await tracker.readTask("not-a-valid-id");

            expect(exec.calls).toEqual([]);
            expect(result).toEqual({
                ok: false,
                error: "not-a-valid-id is not a valid GitHub task id",
            });
        });
    });

    describe("addLabel", () => {
        it("adds one label with the exact argv", async () => {
            const exec = fakeExec(() => ({ ok: true, stdout: "" }));
            const tracker = githubTracker(exec, CONFIG);
            const result = await tracker.addLabel("pabloimrik17/monolab#296", "work");

            expect(exec.calls).toEqual([
                ["issue", "edit", "296", "--repo", "pabloimrik17/monolab", "--add-label", "work"],
            ]);
            expect(result).toEqual({ ok: true, value: undefined });
        });

        it("reports a CLI error naming the command", async () => {
            const exec = fakeExec(() => ({ ok: false, error: "gh failed: boom" }));
            const tracker = githubTracker(exec, CONFIG);
            const result = await tracker.addLabel("pabloimrik17/monolab#296", "work");

            expect(result).toEqual({
                ok: false,
                error: "gh issue edit 296 --repo pabloimrik17/monolab --add-label work: gh failed: boom",
            });
        });

        it("errors on a malformed id", async () => {
            const exec = fakeExec(() => ({ ok: true, stdout: "" }));
            const tracker = githubTracker(exec, CONFIG);
            const result = await tracker.addLabel("no-hash-here", "work");

            expect(exec.calls).toEqual([]);
            expect(result).toEqual({
                ok: false,
                error: "no-hash-here is not a valid GitHub task id",
            });
        });
    });

    describe("listLabels", () => {
        it("lists labels per repo with the exact argv", async () => {
            const exec = fakeExec(() => ({
                ok: true,
                stdout: JSON.stringify([{ name: "bug", color: "D73A4A" }]),
            }));
            const tracker = githubTracker(exec, CONFIG);
            const result = await tracker.listLabels();

            expect(exec.calls).toEqual([
                [
                    "label",
                    "list",
                    "--repo",
                    "pabloimrik17/monolab",
                    "--json",
                    "name,color",
                    "--limit",
                    "1001",
                ],
            ]);
            expect(result).toEqual({
                ok: true,
                value: [{ scope: "pabloimrik17/monolab", name: "bug", colour: "#d73a4a" }],
            });
        });

        it("lists across multiple repos, scoping each label to its repo", async () => {
            const exec = fakeExec(() => ({
                ok: true,
                stdout: JSON.stringify([{ name: "bug", color: "d73a4a" }]),
            }));
            const tracker = githubTracker(exec, MULTI_CONFIG);
            const result = await tracker.listLabels();

            expect(result.ok && result.value.map((label) => label.scope)).toEqual([
                "pabloimrik17/monolab",
                "pabloimrik17/other",
            ]);
        });

        it("reports a listing past the cap as incomplete instead of truncating it", async () => {
            const labels = Array.from({ length: 1001 }, (_, index) => ({
                name: `label-${index}`,
                color: "d73a4a",
            }));
            const exec = fakeExec(() => ({ ok: true, stdout: JSON.stringify(labels) }));
            const tracker = githubTracker(exec, CONFIG);
            const result = await tracker.listLabels();

            expect(result).toEqual({
                ok: false,
                error: "gh label list --repo pabloimrik17/monolab --json name,color: more than 1000 results; the listing would be incomplete",
            });
        });
    });

    describe("createLabel", () => {
        it("creates a label with the colour stripped of its leading #", async () => {
            const exec = fakeExec(() => ({ ok: true, stdout: "" }));
            const tracker = githubTracker(exec, CONFIG);
            const result = await tracker.createLabel("pabloimrik17/monolab", "work", "#2f80ed");

            expect(exec.calls).toEqual([
                ["label", "create", "work", "--repo", "pabloimrik17/monolab", "--color", "2f80ed"],
            ]);
            expect(result).toEqual({ ok: true, value: undefined });
        });

        it("reports a CLI error naming the command", async () => {
            const exec = fakeExec(() => ({
                ok: false,
                error: 'gh failed: label "work" already exists',
            }));
            const tracker = githubTracker(exec, CONFIG);
            const result = await tracker.createLabel("pabloimrik17/monolab", "work", "#2f80ed");

            expect(result).toEqual({
                ok: false,
                error: 'gh label create work --repo pabloimrik17/monolab --color 2f80ed: gh failed: label "work" already exists',
            });
        });
    });

    describe("tracker shape", () => {
        it("declares its configured repos as label scopes and label creation", () => {
            const tracker = githubTracker(
                fakeExec(() => ({ ok: true, stdout: "" })),
                MULTI_CONFIG,
            );
            expect(tracker.source).toBe("github");
            expect(tracker.labelScopes).toEqual(["pabloimrik17/monolab", "pabloimrik17/other"]);
            expect(tracker.createsLabels).toBe(true);
        });
    });
});
