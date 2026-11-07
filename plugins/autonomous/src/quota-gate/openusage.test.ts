import type { ExecFileException } from "node:child_process";

import { describe, expect, it } from "vitest";

import { CLI_TIMEOUT_MS, toExecResult as sharedToExecResult } from "../exec.ts";
import { readOpenUsage } from "./openusage.ts";
import {
    accountErrorDocument,
    accountErrorStderr,
    exitExec,
    fakeExec,
    limits,
    provider,
    session,
    weekly,
} from "./test-fixtures.ts";

const valid = limits({ claude: provider({ session: session(20), weekly: weekly(30) }) });

// Shaped like the errors execFile passes its callback (probed under Bun and Node).
const execError = (message: string, fields: Partial<ExecFileException>): ExecFileException =>
    Object.assign(new Error(message), { cmd: "openusage claude", ...fields });

// The OpenUsage-specific messages come from the shared helper, parameterised by command and timeout.
const toExecResult = (error: ExecFileException | null, stdout: string, stderr: string) =>
    sharedToExecResult("openusage", CLI_TIMEOUT_MS, error, stdout, stderr);

describe("toExecResult", () => {
    it("passes stdout through on success", () => {
        expect(toExecResult(null, "{}", "")).toEqual({ ok: true, stdout: "{}" });
    });

    it("reports a timeout as a timeout", () => {
        const error = execError("Command failed: openusage claude", {
            killed: true,
            signal: "SIGTERM",
        });
        expect(toExecResult(error, "", "")).toEqual({
            ok: false,
            error: "openusage timed out after 120 s",
        });
    });

    it("reports a missing CLI", () => {
        const error = execError('Executable not found in $PATH: "openusage"', { code: "ENOENT" });
        expect(toExecResult(error, "", "")).toEqual({
            ok: false,
            error: "openusage CLI not found on PATH",
        });
    });

    it("reports a maxBuffer overflow as itself, not as a timeout", () => {
        const error = execError("stdout maxBuffer length exceeded", {
            code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
        });
        expect(toExecResult(error, "", "")).toEqual({
            ok: false,
            error: "openusage failed: stdout maxBuffer length exceeded",
        });
    });

    it("reports a non-zero exit with stderr, or the message when stderr is empty", () => {
        const error = execError("Command failed: openusage claude\nboom\n", {
            code: 3,
            killed: false,
        });
        expect(toExecResult(error, "", "boom\n")).toEqual({
            ok: false,
            error: "openusage failed: boom",
        });
        expect(toExecResult(error, "", "")).toEqual({
            ok: false,
            error: "openusage failed: Command failed: openusage claude\nboom\n",
        });
    });
});

describe("readOpenUsage", () => {
    it("parses valid output", async () => {
        const result = await readOpenUsage(fakeExec(valid), false);
        expect(result.ok).toBe(true);
        expect(result.ok && result.limits.providers.claude?.resources.session?.used).toBe(20);
    });

    it("reads the Claude provider from the cache, or refreshes with --force", async () => {
        const exec = fakeExec(valid);
        await readOpenUsage(exec, false);
        await readOpenUsage(exec, true);
        expect(exec.calls).toEqual([["claude"], ["claude", "--force"]]);
    });

    it("reports a CLI failure", async () => {
        const result = await readOpenUsage(
            () => Promise.resolve({ ok: false, error: "openusage CLI not found on PATH" }),
            false,
        );
        expect(result).toEqual({ ok: false, error: "openusage CLI not found on PATH" });
    });

    it("returns a failure without exit output unchanged", async () => {
        const failure = { ok: false as const, error: "openusage timed out after 120 s" };
        const result = await readOpenUsage(() => Promise.resolve(failure), false);
        expect(result).toEqual({ ok: false, error: "openusage timed out after 120 s" });
    });

    it("reports invalid JSON", async () => {
        const result = await readOpenUsage(
            () => Promise.resolve({ ok: true, stdout: "not json" }),
            false,
        );
        expect(result.ok).toBe(false);
        expect(!result.ok && result.error).toMatch(/^openusage output is not valid JSON/);
    });

    it("rejects a different schema id", async () => {
        const result = await readOpenUsage(
            fakeExec({ ...valid, schema: "openusage.limits.v2" }),
            false,
        );
        expect(result).toEqual({
            ok: false,
            error: 'openusage output does not match openusage.limits.v1: $.schema is "openusage.limits.v2", expected "openusage.limits.v1"',
        });
    });

    it("names the path of a missing field", async () => {
        const { stale: _stale, ...noStale } = provider({ session: session(20) });
        const result = await readOpenUsage(fakeExec(limits({ claude: noStale })), false);
        expect(!result.ok && result.error).toContain("$.providers.claude.stale must be a boolean");
    });

    it("names the path of a mistyped resource value", async () => {
        const result = await readOpenUsage(
            fakeExec(limits({ claude: provider({ session: { ...session(20), used: "20" } }) })),
            false,
        );
        expect(!result.ok && result.error).toContain(
            "$.providers.claude.resources.session.used must be a finite number",
        );
    });

    it("accepts resources without optional values and providers without a plan", async () => {
        const { plan: _plan, ...noPlan } = provider({
            session: { kind: "consumption", unit: "percent" },
        });
        const result = await readOpenUsage(fakeExec(limits({ claude: noPlan })), false);
        expect(result.ok && result.limits.providers.claude).toEqual({
            ...noPlan,
            resources: { session: { kind: "consumption", unit: "percent" } },
        });
    });
});

describe("readOpenUsage after a non-zero exit", () => {
    const execError = `openusage failed: ${accountErrorStderr.trim()}`;

    it("reads a valid document that carries an account error", async () => {
        const result = await readOpenUsage(
            exitExec(JSON.stringify(accountErrorDocument), accountErrorStderr),
            false,
        );
        expect(result.ok).toBe(true);
        expect(result.ok && result.limits.errors).toEqual([
            { providerId: "claude@12101920", message: "Claude Swap login is stale" },
        ]);
        expect(result.ok && result.limits.providers.claude?.resources.session?.used).toBe(49);
    });

    it("fails with the exit code when a valid document has no account error", async () => {
        const result = await readOpenUsage(
            exitExec(JSON.stringify(valid), accountErrorStderr),
            false,
        );
        expect(result).toEqual({
            ok: false,
            error: `${execError} (exit 4, no account error in the output)`,
        });
    });

    it.each([
        ["empty stdout", ""],
        ["invalid JSON", "not json"],
        ["a contract violation", JSON.stringify({ ...valid, schema: "openusage.limits.v2" })],
    ])("fails with the exec error, not the parse error, on %s", async (_name, stdout) => {
        const result = await readOpenUsage(exitExec(stdout, accountErrorStderr), false);
        expect(result).toEqual({ ok: false, error: execError });
    });
});
