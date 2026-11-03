// Shared CLI-to-JSON plumbing for every tracker: run an exec, map a failed
// process to an error naming the command, parse stdout as JSON, then let the
// caller's parser validate the shape. `parseError` and `parseJson` are the
// only pieces individual trackers ever imported directly (their tests exercise
// them through `runJson`/`run` instead).

import type { Exec } from "../../exec.ts";
import { object, ParseError, string } from "../../validate.ts";
import type { TrackerResult } from "./tracker.ts";

export function parseError(command: string, error: unknown): string {
    if (error instanceof ParseError) {
        return `${command}: output does not match the expected shape: ${error.message}`;
    }
    return `${command}: output is not valid JSON: ${(error as Error).message}`;
}

export function parseJson(
    command: string,
    stdout: string,
): { ok: true; value: unknown } | { ok: false; error: string } {
    try {
        return { ok: true, value: JSON.parse(stdout) };
    } catch (error) {
        return { ok: false, error: parseError(command, error) };
    }
}

export function commentBodies(
    items: unknown[],
    path: string,
    keys: { body: string; createdAt: string },
): string[] {
    const comments = items.map((item, index) => {
        const entryPath = `${path}[${index}]`;
        const entry = object(item, entryPath);
        return {
            body: string(entry, keys.body, entryPath),
            createdAt: string(entry, keys.createdAt, entryPath),
        };
    });
    comments.sort((a, b) => {
        if (a.createdAt === b.createdAt) {
            return 0;
        }
        return a.createdAt < b.createdAt ? -1 : 1;
    });
    return comments.map((comment) => comment.body);
}

export type MapExecError = (command: string, error: string) => string;

const defaultMapError: MapExecError = (command, error) => `${command}: ${error}`;

export async function runJson<T>(
    exec: Exec,
    command: string,
    args: string[],
    parse: (value: unknown) => T,
    mapError: MapExecError = defaultMapError,
): Promise<TrackerResult<T>> {
    const result = await exec(args);
    if (!result.ok) {
        return { ok: false, error: mapError(command, result.error) };
    }
    const parsed = parseJson(command, result.stdout);
    if (!parsed.ok) {
        return parsed;
    }
    try {
        return { ok: true, value: parse(parsed.value) };
    } catch (error) {
        return { ok: false, error: parseError(command, error) };
    }
}

export async function run(
    exec: Exec,
    command: string,
    args: string[],
    mapError: MapExecError = defaultMapError,
): Promise<TrackerResult<void>> {
    const result = await exec(args);
    if (!result.ok) {
        return { ok: false, error: mapError(command, result.error) };
    }
    return { ok: true, value: undefined };
}
