import { CLI_TIMEOUT_MS, execCommand, type Exec } from "../exec.ts";
import { type OpenUsageLimits, parseLimits } from "./parse.ts";

export type OpenUsageExec = Exec;

export type ReadResult = { ok: true; limits: OpenUsageLimits } | { ok: false; error: string };

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

// OpenUsage 0.7.16 exits 4 both for account warnings, where it still prints the document, and for
// fatal errors, where stdout is empty. So the document decides, not the exit number: it is read
// only when it carries an account error that explains the exit.
function readAfterExit(error: string, exit: { code: number; stdout: string }): ReadResult {
    const parsed = parseOutput(exit.stdout);
    if (!parsed.ok) {
        return { ok: false, error };
    }
    if (parsed.limits.errors.length === 0) {
        return { ok: false, error: `${error} (exit ${exit.code}, no account error in the output)` };
    }
    return parsed;
}

export async function readOpenUsage(exec: OpenUsageExec, force: boolean): Promise<ReadResult> {
    // `--force` refreshes providers; the default reads OpenUsage's shared cache.
    const result = await exec(force ? ["claude", "--force"] : ["claude"]);
    if (result.ok) {
        return parseOutput(result.stdout);
    }
    return result.exit
        ? readAfterExit(result.error, result.exit)
        : { ok: false, error: result.error };
}
