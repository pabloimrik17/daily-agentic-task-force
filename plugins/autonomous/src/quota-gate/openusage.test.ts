import type { ExecFileException } from "node:child_process";

import { describe, expect, it } from "vitest";

import { CLI_TIMEOUT_MS, toExecResult as sharedToExecResult } from "../exec.ts";
import { readOpenUsage } from "./openusage.ts";
import {
    ACCOUNT,
    balance,
    exitExec,
    fakeExec,
    limits,
    nothingFetchedDocument,
    nothingFetchedStderr,
    provider,
    session,
    weekly,
} from "./test-fixtures.ts";

const valid = limits({ [ACCOUNT]: provider({ session: session(20), weekly: weekly(30) }) });

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
        const result = await readOpenUsage(fakeExec(valid));
        expect(result.ok).toBe(true);
        expect(result.ok && result.limits.providers[ACCOUNT]?.resources.session?.used).toBe(20);
    });

    it("reads every Claude account, and never passes --force", async () => {
        const exec = fakeExec(valid);
        await readOpenUsage(exec);
        expect(exec.calls).toEqual([["claude"]]);
    });

    it("reports a CLI failure", async () => {
        const result = await readOpenUsage(() =>
            Promise.resolve({ ok: false, error: "openusage CLI not found on PATH" }),
        );
        expect(result).toEqual({ ok: false, error: "openusage CLI not found on PATH" });
    });

    it("returns a failure without exit output unchanged", async () => {
        const failure = { ok: false as const, error: "openusage timed out after 120 s" };
        const result = await readOpenUsage(() => Promise.resolve(failure));
        expect(result).toEqual({ ok: false, error: "openusage timed out after 120 s" });
    });

    it("reports invalid JSON", async () => {
        const result = await readOpenUsage(() => Promise.resolve({ ok: true, stdout: "not json" }));
        expect(result.ok).toBe(false);
        expect(!result.ok && result.error).toMatch(/^openusage output is not valid JSON/);
    });

    it("names OpenUsage 0.8 for a v1 document", async () => {
        const result = await readOpenUsage(fakeExec({ ...valid, schema: "openusage.limits.v1" }));
        expect(result).toEqual({
            ok: false,
            error: 'openusage output does not match openusage.limits.v2: $.schema is "openusage.limits.v1", which OpenUsage 0.7 prints; the quota gate needs OpenUsage 0.8 or later',
        });
    });

    it("rejects any other schema id", async () => {
        const result = await readOpenUsage(fakeExec({ ...valid, schema: "openusage.limits.v3" }));
        expect(result).toEqual({
            ok: false,
            error: 'openusage output does not match openusage.limits.v2: $.schema is "openusage.limits.v3", expected "openusage.limits.v2"',
        });
    });

    it("names the path of a missing field", async () => {
        const { stale: _stale, ...noStale } = provider({ session: session(20) });
        const result = await readOpenUsage(fakeExec(limits({ [ACCOUNT]: noStale })));
        expect(!result.ok && result.error).toContain(
            `$.providers.${ACCOUNT}.stale must be a boolean`,
        );
    });

    it("names the path of a mistyped resource value", async () => {
        const result = await readOpenUsage(
            fakeExec(limits({ [ACCOUNT]: provider({ session: { ...session(20), used: "20" } }) })),
        );
        expect(!result.ok && result.error).toContain(
            `$.providers.${ACCOUNT}.resources.session.used must be a finite number`,
        );
    });

    it("accepts resources without optional values and providers without a plan", async () => {
        const { plan: _plan, ...noPlan } = provider({
            session: { kind: "consumption", unit: "percent" },
        });
        const result = await readOpenUsage(fakeExec(limits({ [ACCOUNT]: noPlan })));
        expect(result.ok && result.limits.providers[ACCOUNT]).toEqual({
            ...noPlan,
            resources: { session: { kind: "consumption", unit: "percent" } },
        });
    });

    it("keeps a balance's available amount", async () => {
        const result = await readOpenUsage(
            fakeExec(limits({ [ACCOUNT]: provider({ rateLimitResets: balance(2) }) })),
        );
        expect(result.ok && result.limits.providers[ACCOUNT]?.resources.rateLimitResets).toEqual({
            kind: "balance",
            unit: "resets",
            available: 2,
        });
    });
});

describe("readOpenUsage after a non-zero exit", () => {
    const execError = `openusage failed: ${nothingFetchedStderr.trim()}`;

    it("does not read the document printed with exit 4, and names the exit", async () => {
        const result = await readOpenUsage(
            exitExec(JSON.stringify(nothingFetchedDocument), nothingFetchedStderr),
        );
        expect(result).toEqual({ ok: false, error: `${execError} (exit 4)` });
    });

    it("does not read a valid document with Claude accounts after a non-zero exit", async () => {
        const result = await readOpenUsage(exitExec(JSON.stringify(valid), nothingFetchedStderr));
        expect(result).toEqual({ ok: false, error: `${execError} (exit 4)` });
    });

    it.each([
        ["empty stdout", ""],
        ["invalid JSON", "not json"],
        ["a contract violation", JSON.stringify({ ...valid, schema: "openusage.limits.v1" })],
    ])("fails with the exec error, not the parse error, on %s", async (_name, stdout) => {
        const result = await readOpenUsage(exitExec(stdout, nothingFetchedStderr));
        expect(result).toEqual({ ok: false, error: `${execError} (exit 4)` });
    });

    it("reports no Claude account through the CLI failure of exit 2", async () => {
        const stderr = "openusage: Unknown provider: claude\n";
        const result = await readOpenUsage(exitExec("", stderr, 2));
        expect(result).toEqual({
            ok: false,
            error: "openusage failed: openusage: Unknown provider: claude (exit 2)",
        });
    });
});
