// The machine scope (design D5): the `machineType` value of `chezmoi data`,
// `personal` or `work`. The step reads it before any tracker, so every failure
// here makes the step `not-evaluable` with a reason that starts `chezmoi data: `.

import type { Scope } from "../config.ts";
import type { Exec } from "../exec.ts";
import { object, ParseError, string } from "../validate.ts";

type MachineScopeResult = { ok: true; scope: Scope } | { ok: false; error: string };

const PREFIX = "chezmoi data: ";

export async function readMachineScope(exec: Exec): Promise<MachineScopeResult> {
    const result = await exec(["data", "--format", "json"]);
    if (!result.ok) {
        return { ok: false, error: `${PREFIX}${result.error}` };
    }
    try {
        return { ok: true, scope: parseScope(result.stdout) };
    } catch (error) {
        if (!(error instanceof ParseError)) {
            throw error;
        }
        return { ok: false, error: `${PREFIX}${error.message}` };
    }
}

// chezmoi data holds many other keys (the chezmoi block, the user's own data);
// only `machineType` is read, so the others are allowed.
function parseScope(stdout: string): Scope {
    let json: unknown;
    try {
        json = JSON.parse(stdout);
    } catch (error) {
        throw new ParseError(`output is not valid JSON: ${(error as Error).message}`);
    }
    const root = object(json, "output");
    if (!("machineType" in root)) {
        throw new ParseError("output.machineType is missing");
    }
    const value = string(root, "machineType", "output");
    if (value !== "personal" && value !== "work") {
        throw new ParseError(`output.machineType "${value}" is not personal or work`);
    }
    return value;
}
