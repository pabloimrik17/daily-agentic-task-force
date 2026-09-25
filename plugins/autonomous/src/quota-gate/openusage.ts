import { type ExecFileException, execFile } from "node:child_process";

import { type OpenUsageLimits, parseLimits } from "./parse.ts";

export type ExecResult = { ok: true; stdout: string } | { ok: false; error: string };

export type OpenUsageExec = (args: string[]) => Promise<ExecResult>;

export type ReadResult = { ok: true; limits: OpenUsageLimits } | { ok: false; error: string };

// `--force` refreshes providers; the default reads OpenUsage's shared cache.
const TIMEOUT_MS = 120_000;

export function toExecResult(
    error: ExecFileException | null,
    stdout: string,
    stderr: string,
): ExecResult {
    if (!error) {
        return { ok: true, stdout };
    }
    // Only the timeout sets `killed` (a maxBuffer overflow kills the child too, but its error
    // carries its own code and message); the timeout's message is just "Command failed".
    if (error.killed === true) {
        return { ok: false, error: `openusage timed out after ${TIMEOUT_MS / 1000} s` };
    }
    if (error.code === "ENOENT") {
        return { ok: false, error: "openusage CLI not found on PATH" };
    }
    const detail = stderr.trim() || error.message;
    return { ok: false, error: `openusage failed: ${detail}` };
}

export const execOpenUsage: OpenUsageExec = (args) =>
    new Promise((resolve) => {
        execFile("openusage", args, { timeout: TIMEOUT_MS }, (error, stdout, stderr) => {
            resolve(toExecResult(error, stdout, stderr));
        });
    });

export async function readOpenUsage(exec: OpenUsageExec, force: boolean): Promise<ReadResult> {
    const result = await exec(force ? ["claude", "--force"] : ["claude"]);
    if (!result.ok) {
        return result;
    }
    let json: unknown;
    try {
        json = JSON.parse(result.stdout);
    } catch (error) {
        return {
            ok: false,
            error: `openusage output is not valid JSON: ${(error as Error).message}`,
        };
    }
    const parsed = parseLimits(json);
    return parsed.ok ? { ok: true, limits: parsed.value } : { ok: false, error: parsed.error };
}
