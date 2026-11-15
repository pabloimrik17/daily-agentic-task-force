import { CLI_TIMEOUT_MS, execCommand, type Exec } from "../exec.ts";
import { type OpenUsageLimits, parseLimits } from "./parse.ts";

export type OpenUsageExec = Exec;

export type ReadResult = { ok: true; limits: OpenUsageLimits } | { ok: false; error: string };

// The output of a non-zero exit is kept only for its exit code, which the reason names.
export const execOpenUsage: OpenUsageExec = execCommand("openusage", CLI_TIMEOUT_MS, {
    keepOutputOnExit: true,
});

function parseOutput(stdout: string): ReadResult {
    let json: unknown;
    try {
        json = JSON.parse(stdout);
    } catch (error) {
        return {
            ok: false,
            error: `openusage output is not valid JSON: ${(error as Error).message}`,
        };
    }
    const parsed = parseLimits(json);
    return parsed.ok ? { ok: true, limits: parsed.value } : { ok: false, error: parsed.error };
}

// OpenUsage 0.8 prints what its app last fetched and never refreshes, so `--force` is never
// passed: 0.8 ignores it. No non-zero exit carries an account error (design D2): exit 2 is a
// bad argument or no Claude account, and exit 4 is nothing fetched yet, whose document lists no
// Claude account. So the output of a non-zero exit is not read, and the CLI failure is the reason.
export async function readOpenUsage(exec: OpenUsageExec): Promise<ReadResult> {
    const result = await exec(["claude"]);
    if (result.ok) {
        return parseOutput(result.stdout);
    }
    return {
        ok: false,
        error: result.exit ? `${result.error} (exit ${result.exit.code})` : result.error,
    };
}
