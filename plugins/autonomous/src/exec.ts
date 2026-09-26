// One child-process helper shared by every CLI this plugin reaches: OpenUsage,
// bd, gh, linear and claude. Each caller supplies its own command name and
// gets back an `Exec` that names that command in every error message.

import { type ExecFileException, execFile } from "node:child_process";

export type ExecResult = { ok: true; stdout: string } | { ok: false; error: string };

export type Exec = (args: string[], input?: string) => Promise<ExecResult>;

export const CLI_TIMEOUT_MS = 120_000;

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
            const child = execFile(
                command,
                args,
                { timeout: timeoutMs, maxBuffer: MAX_BUFFER },
                (error, stdout, stderr) => {
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
