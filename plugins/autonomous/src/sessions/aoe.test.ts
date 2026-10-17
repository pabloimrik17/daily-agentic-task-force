import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { Exec, ExecResult } from "../exec.ts";
import { aoeManager, mapStatus, shellQuote } from "./aoe.ts";
import type { SessionSpec } from "./manager.ts";

// Recorded from aoe 1.14.0 on 2026-10-17; paths shortened.
const ADD_STDOUT = `✓ Added session: auto 🧪 Fixture (X-1)
  Profile: main
  Path:    /private/tmp/scratchpad/wtfix/repo
  Group:   Daily agentic task force
  ID:      336c83018fca4d13

Next steps:
  aoe session start auto 🧪 Fixture (X-1)   # Start the session
  aoe                         # Open TUI and press Enter to attach
`;

const SHOW_AFTER_ADD = {
    id: "27f3be7f6a3a4f81",
    title: "auto 🧪 Fixture two (X-2)",
    path: "/private/tmp/scratchpad/wtfix/repo",
    group: "Daily agentic task force",
    tool: "claude",
    command: "",
    status: "error",
    profile: "main",
};

const SHOW_AFTER_START = {
    ...SHOW_AFTER_ADD,
    status: "running",
    agent_session_id: "4daf1b40-6249-4a25-bdd7-0a69bc77e342",
};

const LIST_ENTRY = {
    id: "336c83018fca4d13",
    title: "auto 🧪 Fixture (X-1)",
    path: "/private/tmp/scratchpad/wtfix/repo",
    group: "Daily agentic task force",
    tool: "claude",
    profile: "main",
    created_at: "2026-10-17T13:00:19.636246Z",
    workspace_repos: [],
};

const NOT_FOUND_ERROR = "aoe failed: Error: Session not found: 0000000000000000";

const NOT_FOUND: ExecResult = { ok: false, error: NOT_FOUND_ERROR };

const SPEC: SessionSpec = {
    path: "/repos/repo-worktrees/feature-X-1-fixture",
    title: "auto 🧪 Fixture (X-1)",
    group: "Daily agentic task force",
    tool: "claude",
    binary: null,
    args: ["--model", "haiku"],
    instruction: "Read /state/attempts/linear/X-1/test/1/prompt.md and follow it.",
};

function fakeExec(handler: (args: string[]) => ExecResult): Exec & { calls: string[][] } {
    const calls: string[][] = [];
    const exec = (args: string[]) => {
        calls.push(args);
        return Promise.resolve(handler(args));
    };
    return Object.assign(exec, { calls });
}

function json(value: unknown): ExecResult {
    return { ok: true, stdout: JSON.stringify(value) };
}

// Answers every aoe command with its recorded output.
function recorded(args: string[]): ExecResult {
    const command = args
        .filter((arg) => !arg.startsWith("-"))
        .slice(0, 2)
        .join(" ");
    if (args[0] === "add") {
        return { ok: true, stdout: ADD_STDOUT };
    }
    if (command.startsWith("session show")) {
        return json(SHOW_AFTER_START);
    }
    if (command.startsWith("session start")) {
        return { ok: true, stdout: "✓ Started session: auto 🧪 Fixture two (X-2)\n" };
    }
    if (command.startsWith("session capture")) {
        return { ok: true, stdout: "pane text\n" };
    }
    if (args[0] === "list") {
        return json([LIST_ENTRY]);
    }
    if (command.startsWith("group list")) {
        return json([{ name: "Dotfiles", path: "Dotfiles", session_count: 18, children: [] }]);
    }
    return { ok: true, stdout: "  Removed session: auto 🧪 Fixture (X-1) (from profile 'main')\n" };
}

async function everyCommand(profile: string | null): Promise<string[][]> {
    const exec = fakeExec(recorded);
    const manager = aoeManager(exec, profile);
    await manager.create(SPEC);
    await manager.start("336c83018fca4d13");
    await manager.observe("336c83018fca4d13");
    await manager.findByPath("/nowhere/repo");
    await manager.listGroups();
    await manager.capture("336c83018fca4d13", 200);
    await manager.remove("336c83018fca4d13");
    return exec.calls;
}

describe("mapStatus (design D3)", () => {
    it.each([
        ["running", { state: "open", busy: true, needsHuman: false }],
        ["starting", { state: "open", busy: true, needsHuman: false }],
        ["creating", { state: "open", busy: true, needsHuman: false }],
        ["idle", { state: "open", busy: false, needsHuman: false }],
        ["unknown", { state: "open", busy: false, needsHuman: false }],
        ["waiting", { state: "open", busy: false, needsHuman: true }],
        ["stopped", { state: "exited", busy: false, needsHuman: false }],
        ["error", { state: "exited", busy: false, needsHuman: false }],
        ["deleting", { state: "exited", busy: false, needsHuman: false }],
    ])("maps %s through observe", async (status, mapped) => {
        const exec = fakeExec(() => json({ ...SHOW_AFTER_START, status }));
        const result = await aoeManager(exec, null).observe("27f3be7f6a3a4f81");

        expect(mapStatus(status)).toEqual(mapped);
        expect(result).toEqual({
            ok: true,
            value: { ...mapped, status, agentSessionId: "4daf1b40-6249-4a25-bdd7-0a69bc77e342" },
        });
    });

    it("treats a status it does not know as open and not busy, reported verbatim", async () => {
        const exec = fakeExec(() => json({ ...SHOW_AFTER_START, status: "hibernating" }));
        const result = await aoeManager(exec, null).observe("27f3be7f6a3a4f81");

        expect(result).toEqual({
            ok: true,
            value: {
                state: "open",
                status: "hibernating",
                busy: false,
                needsHuman: false,
                agentSessionId: "4daf1b40-6249-4a25-bdd7-0a69bc77e342",
            },
        });
    });
});

describe("shellQuote", () => {
    it("single-quotes the value and escapes ' as '\\''", () => {
        expect(shellQuote("Read /tmp/it's/prompt.md and follow it.")).toBe(
            "'Read /tmp/it'\\''s/prompt.md and follow it.'",
        );
    });
});

describe("aoeManager", () => {
    describe("create", () => {
        it("adds without --launch or --yolo, parses the ID line and confirms it", async () => {
            const exec = fakeExec(recorded);
            const result = await aoeManager(exec, null).create(SPEC);

            expect(result).toEqual({ ok: true, value: { id: "336c83018fca4d13" } });
            expect(exec.calls).toEqual([
                [
                    "add",
                    SPEC.path,
                    "--title",
                    SPEC.title,
                    "--group",
                    SPEC.group,
                    "--tool",
                    "claude",
                    "--extra-args",
                    "--model haiku 'Read /state/attempts/linear/X-1/test/1/prompt.md and follow it.'",
                ],
                ["session", "show", "336c83018fca4d13", "--json"],
            ]);
            expect(exec.calls.flat()).not.toContain("--yolo");
            expect(exec.calls.flat()).not.toContain("--launch");
        });

        it("passes the binary as --cmd-override and escapes the instruction's quote", async () => {
            const exec = fakeExec(recorded);
            await aoeManager(exec, null).create({
                ...SPEC,
                tool: "codex",
                binary: "/usr/local/bin/codex",
                args: ["-m", "gpt-6.1-sol"],
                instruction: "Read the task's prompt.md.",
            });

            expect(exec.calls[0]).toEqual([
                "add",
                SPEC.path,
                "--title",
                SPEC.title,
                "--group",
                SPEC.group,
                "--tool",
                "codex",
                "--cmd-override",
                "/usr/local/bin/codex",
                "--extra-args",
                "-m gpt-6.1-sol 'Read the task'\\''s prompt.md.'",
            ]);
        });

        it("is an error when the output carries no ID line", async () => {
            const exec = fakeExec(() => ({
                ok: true,
                stdout: "✓ Added session: auto 🧪 Fixture (X-1)\n",
            }));
            const result = await aoeManager(exec, null).create(SPEC);

            expect(result).toEqual({ ok: false, error: "aoe add: no ID line in output" });
            expect(exec.calls).toHaveLength(1);
        });

        it("is an error naming aoe add when the command fails", async () => {
            const exec = fakeExec(() => ({ ok: false, error: "aoe timed out after 120 s" }));

            expect(await aoeManager(exec, null).create(SPEC)).toEqual({
                ok: false,
                error: "aoe add: aoe timed out after 120 s",
            });
        });

        it("is an error when the new id cannot be read back", async () => {
            const exec = fakeExec((args) => (args[0] === "add" ? recorded(args) : NOT_FOUND));
            const result = await aoeManager(exec, null).create(SPEC);

            expect(result).toEqual({
                ok: false,
                error: "aoe session show 336c83018fca4d13 --json: Session not found right after aoe add",
            });
        });

        it("is the show's error when the read-back fails otherwise", async () => {
            const exec = fakeExec((args) =>
                args[0] === "add" ? recorded(args) : { ok: false, error: "aoe failed: boom" },
            );

            expect(await aoeManager(exec, null).create(SPEC)).toEqual({
                ok: false,
                error: "aoe session show 336c83018fca4d13 --json: aoe failed: boom",
            });
        });
    });

    describe("start", () => {
        it("starts the session by id", async () => {
            const exec = fakeExec(recorded);

            expect(await aoeManager(exec, null).start("27f3be7f6a3a4f81")).toEqual({
                ok: true,
                value: undefined,
            });
            expect(exec.calls).toEqual([["session", "start", "27f3be7f6a3a4f81"]]);
        });
    });

    describe("observe", () => {
        it("reads a never-started session, which has no agent_session_id", async () => {
            const exec = fakeExec(() => json(SHOW_AFTER_ADD));
            const result = await aoeManager(exec, null).observe("27f3be7f6a3a4f81");

            expect(result).toEqual({
                ok: true,
                value: {
                    state: "exited",
                    status: "error",
                    busy: false,
                    needsHuman: false,
                    agentSessionId: null,
                },
            });
            expect(exec.calls).toEqual([["session", "show", "27f3be7f6a3a4f81", "--json"]]);
        });

        it("is gone when the session is not found", async () => {
            const exec = fakeExec(() => NOT_FOUND);

            expect(await aoeManager(exec, null).observe("0000000000000000")).toEqual({
                ok: true,
                value: {
                    state: "gone",
                    status: "not found",
                    busy: false,
                    needsHuman: false,
                    agentSessionId: null,
                },
            });
        });

        it("is an error naming the command on any other failure", async () => {
            const exec = fakeExec(() => ({ ok: false, error: "aoe CLI not found on PATH" }));

            expect(await aoeManager(exec, null).observe("27f3be7f6a3a4f81")).toEqual({
                ok: false,
                error: "aoe session show 27f3be7f6a3a4f81 --json: aoe CLI not found on PATH",
            });
        });

        it("is an error naming the command when status is missing", async () => {
            const { status: _status, ...withoutStatus } = SHOW_AFTER_START;
            const exec = fakeExec(() => json(withoutStatus));

            expect(await aoeManager(exec, null).observe("27f3be7f6a3a4f81")).toEqual({
                ok: false,
                error: "aoe session show 27f3be7f6a3a4f81 --json: output does not match the expected shape: $.status must be a string",
            });
        });
    });

    describe("findByPath", () => {
        const dirs: string[] = [];

        afterEach(async () => {
            await Promise.all(
                dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
            );
        });

        it("matches entries by realpath on both sides", async () => {
            const root = await mkdtemp(join(tmpdir(), "aoe-test-"));
            dirs.push(root);
            const real = join(root, "repo");
            await mkdir(real);
            const link = join(root, "link");
            await symlink(real, link);
            const exec = fakeExec(() =>
                json([
                    { ...LIST_ENTRY, id: "1111111111111111", path: link },
                    { ...LIST_ENTRY, id: "2222222222222222", path: join(root, "other") },
                    { ...LIST_ENTRY, id: "3333333333333333", path: real },
                ]),
            );

            const result = await aoeManager(exec, null).findByPath(real);

            expect(result).toEqual({ ok: true, value: ["1111111111111111", "3333333333333333"] });
            expect(exec.calls).toEqual([["list", "--json"]]);
        });

        it("compares paths that do not exist as resolved", async () => {
            const exec = fakeExec(() => json([LIST_ENTRY]));

            expect(
                await aoeManager(exec, null).findByPath("/private/tmp/scratchpad/wtfix/./repo/"),
            ).toEqual({ ok: true, value: ["336c83018fca4d13"] });
        });

        it("is an error naming aoe list --json on a malformed entry", async () => {
            const exec = fakeExec(() => json([{ id: "336c83018fca4d13" }]));

            expect(await aoeManager(exec, null).findByPath("/x")).toEqual({
                ok: false,
                error: "aoe list --json: output does not match the expected shape: $[0].path must be a string",
            });
        });
    });

    describe("listGroups", () => {
        it("collects every group path through nested children", async () => {
            const exec = fakeExec(() =>
                json([
                    { name: "Dotfiles", path: "Dotfiles", session_count: 18, children: [] },
                    {
                        name: "Monolab",
                        path: "Monolab",
                        session_count: 0,
                        children: [
                            {
                                name: "Qup",
                                path: "Monolab/Qup",
                                session_count: 1,
                                children: [{ name: "Api", path: "Monolab/Qup/Api", children: [] }],
                            },
                        ],
                    },
                ]),
            );

            expect(await aoeManager(exec, null).listGroups()).toEqual({
                ok: true,
                value: ["Dotfiles", "Monolab", "Monolab/Qup", "Monolab/Qup/Api"],
            });
            expect(exec.calls).toEqual([["group", "list", "--json"]]);
        });

        it("is an error naming aoe group list --json with the nested path", async () => {
            const exec = fakeExec(() => json([{ path: "Monolab", children: [{ name: "Qup" }] }]));

            expect(await aoeManager(exec, null).listGroups()).toEqual({
                ok: false,
                error: "aoe group list --json: output does not match the expected shape: $[0].children[0].path must be a string",
            });
        });
    });

    describe("capture", () => {
        it("returns the pane text as printed", async () => {
            const exec = fakeExec(recorded);

            expect(await aoeManager(exec, null).capture("27f3be7f6a3a4f81", 200)).toEqual({
                ok: true,
                value: "pane text\n",
            });
            expect(exec.calls).toEqual([
                ["session", "capture", "27f3be7f6a3a4f81", "-n", "200", "--strip-ansi"],
            ]);
        });

        it("is an error naming the command", async () => {
            const exec = fakeExec(() => ({ ok: false, error: "aoe failed: no pane" }));

            expect(await aoeManager(exec, null).capture("27f3be7f6a3a4f81", 200)).toEqual({
                ok: false,
                error: "aoe session capture 27f3be7f6a3a4f81: aoe failed: no pane",
            });
        });
    });

    describe("remove", () => {
        it("purges and never deletes the worktree", async () => {
            const exec = fakeExec(recorded);

            expect(await aoeManager(exec, null).remove("336c83018fca4d13")).toEqual({
                ok: true,
                value: undefined,
            });
            expect(exec.calls).toEqual([["remove", "336c83018fca4d13", "--purge"]]);
            expect(exec.calls.flat()).not.toContain("--delete-worktree");
        });

        it("is an error naming the command", async () => {
            const exec = fakeExec(() => NOT_FOUND);

            expect(await aoeManager(exec, null).remove("0000000000000000")).toEqual({
                ok: false,
                error: `aoe remove 0000000000000000: ${NOT_FOUND_ERROR}`,
            });
        });
    });

    describe("profile", () => {
        it("passes --profile right after the leaf subcommand of every command", async () => {
            expect(await everyCommand("work")).toEqual([
                ["add", "--profile", "work", ...(await everyCommand(null))[0]!.slice(1)],
                ["session", "show", "--profile", "work", "336c83018fca4d13", "--json"],
                ["session", "start", "--profile", "work", "336c83018fca4d13"],
                ["session", "show", "--profile", "work", "336c83018fca4d13", "--json"],
                ["list", "--profile", "work", "--json"],
                ["group", "list", "--profile", "work", "--json"],
                [
                    "session",
                    "capture",
                    "--profile",
                    "work",
                    "336c83018fca4d13",
                    "-n",
                    "200",
                    "--strip-ansi",
                ],
                ["remove", "--profile", "work", "336c83018fca4d13", "--purge"],
            ]);
        });

        it("passes no profile flag anywhere when none is configured", async () => {
            const calls = await everyCommand(null);

            expect(calls).toHaveLength(8);
            expect(calls.flat()).not.toContain("--profile");
            expect(calls.flat()).not.toContain("profile");
            expect(calls.flat()).not.toContain("--yolo");
        });
    });
});
