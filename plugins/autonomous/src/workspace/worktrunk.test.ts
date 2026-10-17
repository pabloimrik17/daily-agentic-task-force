import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { Exec, ExecResult } from "../exec.ts";
import { WORKSPACE_TIMEOUT_MS, worktrunkManager } from "./worktrunk.ts";

const dirs: string[] = [];

afterEach(() => {
    for (const dir of dirs.splice(0)) {
        rmSync(dir, { recursive: true, force: true });
    }
});

function worktree(): string {
    const dir = mkdtempSync(join(tmpdir(), "wt-"));
    dirs.push(dir);
    return dir;
}

function recorder(result: ExecResult, calls: string[][]): Exec {
    return (args) => {
        calls.push(args);
        return Promise.resolve(result);
    };
}

const SHA: ExecResult = { ok: true, stdout: "0123abc\n" };
const MISSING: ExecResult = { ok: false, error: "git failed: " };
const BRANCH = "feature/X-2-demo";

describe("worktrunk prepare", () => {
    it("switches to an existing branch without --create", async () => {
        const path = worktree();
        const wtCalls: string[][] = [];
        const gitCalls: string[][] = [];
        const manager = worktrunkManager(
            recorder(
                {
                    ok: true,
                    stdout: JSON.stringify({ action: "existing", branch: BRANCH, path }),
                },
                wtCalls,
            ),
            recorder(SHA, gitCalls),
        );

        expect(await manager.prepare("/r/repo", BRANCH)).toEqual({
            ok: true,
            value: { path, created: false },
        });
        expect(gitCalls).toEqual([
            ["-C", "/r/repo", "rev-parse", "--verify", "--quiet", `refs/heads/${BRANCH}`],
        ]);
        expect(wtCalls).toEqual([["-C", "/r/repo", "switch", BRANCH, "--no-cd", "--format=json"]]);
    });

    it("creates a new branch with --create", async () => {
        const path = worktree();
        const wtCalls: string[][] = [];
        const manager = worktrunkManager(
            recorder(
                {
                    ok: true,
                    stdout: JSON.stringify({
                        action: "created",
                        branch: BRANCH,
                        path,
                        created_branch: true,
                        base_branch: "main",
                    }),
                },
                wtCalls,
            ),
            recorder(MISSING, []),
        );

        expect(await manager.prepare("/r/repo", BRANCH)).toEqual({
            ok: true,
            value: { path, created: true },
        });
        expect(wtCalls).toEqual([
            ["-C", "/r/repo", "switch", "--create", BRANCH, "--no-cd", "--format=json"],
        ]);
    });

    it("fails when the reported path does not exist", async () => {
        const manager = worktrunkManager(
            recorder(
                {
                    ok: true,
                    stdout: JSON.stringify({ action: "created", path: "/nowhere/at/all" }),
                },
                [],
            ),
            recorder(MISSING, []),
        );

        expect(await manager.prepare("/r/repo", BRANCH)).toEqual({
            ok: false,
            error: "wt switch: path /nowhere/at/all does not exist",
        });
    });

    it("fails naming wt switch when wt times out", async () => {
        const manager = worktrunkManager(
            recorder({ ok: false, error: "wt timed out after 120 s" }, []),
            recorder(SHA, []),
        );

        expect(await manager.prepare("/r/repo", BRANCH)).toEqual({
            ok: false,
            error: "wt switch: wt timed out after 120 s",
        });
    });

    it.each([
        ["output that is not JSON", "Switched to branch"],
        ["a path that is not a string", JSON.stringify({ action: "created", path: 3 })],
        ["an action it does not know", JSON.stringify({ action: "moved", path: "/x" })],
    ])("rejects %s", async (_name, stdout) => {
        const manager = worktrunkManager(recorder({ ok: true, stdout }, []), recorder(SHA, []));

        const result = await manager.prepare("/r/repo", BRANCH);

        expect(result.ok).toBe(false);
        expect(!result.ok && result.error).toMatch(/^wt switch: /);
    });
});

describe("worktrunk release", () => {
    it("removes the worktree and keeps the branch", async () => {
        const wtCalls: string[][] = [];
        const manager = worktrunkManager(
            recorder({ ok: true, stdout: "[]" }, wtCalls),
            recorder(SHA, []),
        );

        expect(await manager.release("/r/repo", BRANCH)).toEqual({
            ok: true,
            value: undefined,
        });
        expect(wtCalls).toEqual([
            [
                "-C",
                "/r/repo",
                "remove",
                BRANCH,
                "--no-delete-branch",
                "--foreground",
                "--format=json",
            ],
        ]);
    });

    it("fails naming wt remove", async () => {
        const manager = worktrunkManager(
            recorder({ ok: false, error: "wt failed: ✗ No branch named feature/nope" }, []),
            recorder(SHA, []),
        );

        expect(await manager.release("/r/repo", "feature/nope")).toEqual({
            ok: false,
            error: "wt remove: wt failed: ✗ No branch named feature/nope",
        });
    });
});

describe("worktrunk limits", () => {
    it("gives wt 120 s, long enough for the hooks that run in the foreground", () => {
        expect(WORKSPACE_TIMEOUT_MS).toBe(120_000);
    });
});
