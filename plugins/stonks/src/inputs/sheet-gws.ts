// The one file that knows `gws`, the Google Workspace CLI: it builds the
// command that reads the tracking sheet's tab, runs it through an injectable
// runner and classifies every way the call can fail. It returns raw cell
// values; `sheet.ts` decides what they mean.

import { spawn } from "node:child_process";

import type { StonksConfig } from "../domain.ts";

export type SheetErrorKind = "gws-missing" | "gws-unauthorised" | "gws-failed" | "gws-bad-output";

export interface SheetError {
    kind: SheetErrorKind;
    message: string;
}

export type SheetRead = { ok: true; values: unknown[][] } | { ok: false; error: SheetError };

export interface RunnerResult {
    code: number | null;
    stdout: string;
    stderr: string;
    spawnError?: NodeJS.ErrnoException;
}

/** Runs `argv[0]` with the rest as arguments, without a shell. */
export type Runner = (argv: string[]) => Promise<RunnerResult>;

export type SheetLocation = StonksConfig["trackingSheet"];

const GWS_TIMEOUT_MS = 60_000;

// gws prints this on every call, success or not; it says nothing about the failure.
const KEYRING_LINE = /^Using keyring backend:.*$/gm;
const AUTH_HINT =
    /error\[auth\]|\b401\b|\b403\b|unauthenticated|unauthorized|credentials|token|login/i;

/** The A1 range of the five columns of a tab; apostrophes in the name are doubled. */
export function buildRange(tab: string): string {
    return `'${tab.replaceAll("'", "''")}'!A:E`;
}

/** UNFORMATTED_VALUE keeps numbers numbers; the default renders them as currency strings. */
export function buildArgs(location: SheetLocation): string[] {
    const params = {
        spreadsheetId: location.spreadsheetId,
        range: buildRange(location.tab),
        valueRenderOption: "UNFORMATTED_VALUE",
    };
    return ["gws", "sheets", "spreadsheets", "values", "get", "--params", JSON.stringify(params)];
}

const defaultRunner: Runner = (argv) =>
    new Promise((resolve) => {
        const [command, ...args] = argv;
        let stdout = "";
        let stderr = "";
        let settled = false;
        const settle = (result: RunnerResult): void => {
            if (!settled) {
                settled = true;
                resolve(result);
            }
        };
        const child = spawn(command ?? "", args, {
            stdio: ["ignore", "pipe", "pipe"],
            timeout: GWS_TIMEOUT_MS,
        });
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (chunk: string) => {
            stdout += chunk;
        });
        child.stderr.on("data", (chunk: string) => {
            stderr += chunk;
        });
        child.on("error", (error: NodeJS.ErrnoException) => {
            settle({ code: null, stdout, stderr, spawnError: error });
        });
        child.on("close", (code, signal) => {
            const note =
                signal === null
                    ? ""
                    : `\ngws was stopped by ${signal} (timeout ${GWS_TIMEOUT_MS / 1000} s)`;
            settle({ code, stdout, stderr: stderr + note });
        });
    });

function fail(kind: SheetErrorKind, message: string): SheetRead {
    return { ok: false, error: { kind, message } };
}

export async function readSheetValues(
    location: SheetLocation,
    runner: Runner = defaultRunner,
): Promise<SheetRead> {
    const result = await runner(buildArgs(location));
    if (result.spawnError !== undefined) {
        if (result.spawnError.code === "ENOENT") {
            return fail(
                "gws-missing",
                "gws is not on PATH; install the Google Workspace CLI to read the tracking sheet",
            );
        }
        return fail("gws-failed", `gws could not be started: ${result.spawnError.message}`);
    }
    const detail = `${result.stderr.replace(KEYRING_LINE, "")}\n${result.stdout}`.trim();
    if (result.code !== 0) {
        if (AUTH_HINT.test(detail)) {
            return fail(
                "gws-unauthorised",
                `gws is not authorised to read the tracking sheet: ${detail}`,
            );
        }
        const exit = result.code === null ? "was stopped" : `exited with code ${result.code}`;
        return fail("gws-failed", `gws ${exit}: ${detail}`);
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(result.stdout);
    } catch {
        return fail("gws-bad-output", "gws output is not JSON");
    }
    const values =
        typeof parsed === "object" && parsed !== null
            ? (parsed as { values?: unknown }).values
            : undefined;
    if (!Array.isArray(values) || !values.every((row) => Array.isArray(row))) {
        return fail("gws-bad-output", "gws output has no `values` array of rows");
    }
    return { ok: true, values: values as unknown[][] };
}
