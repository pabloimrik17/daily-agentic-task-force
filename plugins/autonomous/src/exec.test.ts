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
});
