import { CLI_TIMEOUT_MS, execCommand, type Exec } from "../exec.ts";
import { type OpenUsageLimits, parseLimits } from "./parse.ts";

export type OpenUsageExec = Exec;

export type ReadResult = { ok: true; limits: OpenUsageLimits } | { ok: false; error: string };

export const execOpenUsage: OpenUsageExec = execCommand("openusage", CLI_TIMEOUT_MS);

export async function readOpenUsage(exec: OpenUsageExec, force: boolean): Promise<ReadResult> {
    // `--force` refreshes providers; the default reads OpenUsage's shared cache.
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
