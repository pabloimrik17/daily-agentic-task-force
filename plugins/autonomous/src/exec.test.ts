import type { ExecFileException } from "node:child_process";

import { describe, expect, it } from "vitest";

import { execCommand, toExecResult } from "./exec.ts";

// Shaped like the errors execFile passes its callback (probed under Bun and Node).
const execError = (message: string, fields: Partial<ExecFileException>): ExecFileException =>
    Object.assign(new Error(message), { cmd: "bd list --json", ...fields });

describe("toExecResult", () => {
    it("passes stdout through on success", () => {
        expect(toExecResult("bd list --json", 120_000, null, "{}", "")).toEqual({
            ok: true,
            stdout: "{}",
        });
    });

    it("reports a timeout as a timeout", () => {
        const error = execError("Command failed: bd list --json", {
            killed: true,
            signal: "SIGTERM",
        });
        expect(toExecResult("bd list --json", 120_000, error, "", "")).toEqual({
            ok: false,
            error: "bd list --json timed out after 120 s",
        });
    });

    it("reports a missing CLI", () => {
        const error = execError('Executable not found in $PATH: "bd"', { code: "ENOENT" });
        expect(toExecResult("bd list --json", 120_000, error, "", "")).toEqual({
            ok: false,
            error: "bd list --json CLI not found on PATH",
        });
    });

    it("reports a maxBuffer overflow as itself, not as a timeout", () => {
        const error = execError("stdout maxBuffer length exceeded", {
            code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
        });
        expect(toExecResult("bd list --json", 120_000, error, "", "")).toEqual({
            ok: false,
            error: "bd list --json failed: stdout maxBuffer length exceeded",
        });
    });

    it("reports a non-zero exit with stderr, or the message when stderr is empty", () => {
        const error = execError("Command failed: bd list --json\nboom\n", {
            code: 3,
            killed: false,
        });
        expect(toExecResult("bd list --json", 120_000, error, "", "boom\n")).toEqual({
            ok: false,
            error: "bd list --json failed: boom",
        });
        expect(toExecResult("bd list --json", 120_000, error, "", "")).toEqual({
            ok: false,
            error: "bd list --json failed: Command failed: bd list --json\nboom\n",
        });
    });

    it("keeps the exit code and stdout of a non-zero exit when asked to", () => {
        const error = execError("Command failed: bd list --json\nboom\n", {
            code: 4,
            killed: false,
        });
        expect(
            toExecResult("bd list --json", 120_000, error, "{}", "boom\n", {
                keepOutputOnExit: true,
            }),
        ).toStrictEqual({
            ok: false,
            error: "bd list --json failed: boom",
            exit: { code: 4, stdout: "{}" },
        });
    });

    it("leaves the exit out when not asked to", () => {
        const error = execError("Command failed: bd list --json\nboom\n", {
            code: 4,
            killed: false,
        });
        expect(toExecResult("bd list --json", 120_000, error, "{}", "boom\n")).toStrictEqual({
            ok: false,
            error: "bd list --json failed: boom",
        });
    });

    it.each<[string, Partial<ExecFileException>, string]>([
        ["a timeout", { killed: true, signal: "SIGTERM" }, "bd list --json timed out after 120 s"],
        ["a missing CLI", { code: "ENOENT" }, "bd list --json CLI not found on PATH"],
        [
            "a maxBuffer overflow",
            { code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" },
            "bd list --json failed: overflow",
        ],
        [
            "a kill by signal",
            {
                code: null,
                signal: "SIGKILL",
                killed: false,
            } as unknown as Partial<ExecFileException>,
            "bd list --json failed: overflow",
        ],
    ])("never keeps the exit of %s", (_name, fields, expected) => {
        const error = execError("overflow", fields);
        expect(
            toExecResult("bd list --json", 120_000, error, "partial", "", {
                keepOutputOnExit: true,
            }),
        ).toStrictEqual({ ok: false, error: expected });
    });
});

describe("execCommand", () => {
    it("writes input to the child's stdin and returns its stdout", async () => {
        const exec = execCommand("sh");
        const result = await exec(["-c", "cat"], "hello from stdin");
        expect(result).toEqual({ ok: true, stdout: "hello from stdin" });
    });

    it("reports a child that exits before draining a large input as a failure, not a crash", async () => {
        const exec = execCommand("sh");
        const result = await exec(["-c", "exit 3"], "x".repeat(4 * 1024 * 1024));
        expect(result).toMatchObject({ ok: false });
    });

    it("reports a missing binary as not found on PATH", async () => {
        const exec = execCommand("this-binary-does-not-exist-anywhere");
        const result = await exec([]);
        expect(result).toEqual({
            ok: false,
            error: "this-binary-does-not-exist-anywhere CLI not found on PATH",
        });
    });

    it("keeps the exit code and stdout of a real non-zero exit when asked to", async () => {
        const exec = execCommand("sh", undefined, { keepOutputOnExit: true });
        const result = await exec(["-c", "printf '{}'; echo boom >&2; exit 4"]);
        expect(result).toStrictEqual({
            ok: false,
            error: "sh failed: boom",
            exit: { code: 4, stdout: "{}" },
        });
    });

    it("leaves the exit out of a real non-zero exit by default", async () => {
        const exec = execCommand("sh");
        const result = await exec(["-c", "printf '{}'; echo boom >&2; exit 4"]);
        expect(result).toStrictEqual({ ok: false, error: "sh failed: boom" });
    });
});
