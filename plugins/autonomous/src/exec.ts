// One child-process helper shared by every CLI this plugin reaches: OpenUsage,
// bd, gh, linear and claude. Each caller supplies its own command name and
// gets back an `Exec` that names that command in every error message.

import { type ExecFileException, execFile } from "node:child_process";

export type ExecResult = { ok: true; stdout: string } | { ok: false; error: string };

export type Exec = (args: string[], input?: string) => Promise<ExecResult>;

export const CLI_TIMEOUT_MS = 120_000;

// How long after its own timeout execFile gets to report the kill before the watchdog
// settles the call without it.
export const WATCHDOG_GRACE_MS = 5_000;

const MAX_BUFFER = 64 * 1024 * 1024;

export function toExecResult(
    command: string,
    timeoutMs: number,
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
        return { ok: false, error: `${command} timed out after ${timeoutMs / 1000} s` };
    }
    if (error.code === "ENOENT") {
        return { ok: false, error: `${command} CLI not found on PATH` };
    }
    const detail = stderr.trim() || error.message;
    return { ok: false, error: `${command} failed: ${detail}` };
}

export function execCommand(command: string, timeoutMs = CLI_TIMEOUT_MS): Exec {
    return (args, input) =>
        new Promise((resolve) => {
            // Bun can lose a child's exit notification (oven-sh/bun#41024, #34069). execFile then
            // never calls back, and its own timeout cannot help: it only signals the child and
            // still waits for that same notification. The watchdog settles the call regardless.
            const watchdog = setTimeout(() => {
                try {
                    child.kill("SIGKILL");
                } catch {
                    // The child is already gone, or execFile threw before creating it; the call
                    // is settled below either way.
                }
                resolve({
                    ok: false,
                    error: `${command} timed out after ${timeoutMs / 1000} s (exit never reported)`,
                });
            }, timeoutMs + WATCHDOG_GRACE_MS);
            const child = execFile(
                command,
                args,
                { timeout: timeoutMs, maxBuffer: MAX_BUFFER },
                (error, stdout, stderr) => {
                    clearTimeout(watchdog);
                    resolve(toExecResult(command, timeoutMs, error, stdout, stderr));
                },
            );
            if (input !== undefined) {
                // A child that exits before draining its input raises EPIPE here; the execFile
                // callback already reports that exit, so the stream error is dropped.
                child.stdin?.on("error", () => {});
                child.stdin?.end(input);
            }
        });
}
