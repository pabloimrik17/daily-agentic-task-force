// Validation of the envelope every browser collector returns (design D5,
// D10): the right collector, the current run, a boolean login-wall flag and an
// object of data. A login wall is its own error so the step can print
// `ask-login`; a result from another run is rejected naming it.

import type { CollectorEnvelope } from "../domain.ts";
import { ParseError, type Json, boolean, object, string } from "../validate.ts";

export type ReadError = { kind: "login-wall" } | { kind: "unreadable"; message: string };

export type ReadResult<T> = { ok: true; value: T } | { ok: false; error: ReadError };

export type ValidEnvelope = Omit<CollectorEnvelope, "data"> & { data: Json };

export const unreadable = (message: string): { ok: false; error: ReadError } => ({
    ok: false,
    error: { kind: "unreadable", message },
});

/** Runs a throwing strict reader and turns a `ParseError` into an unreadable result. */
export function guard<T>(read: () => ReadResult<T>): ReadResult<T> {
    try {
        return read();
    } catch (error) {
        if (error instanceof ParseError) {
            return unreadable(error.message);
        }
        throw error;
    }
}

/**
 * `javascript_tool` cuts a result before the hook sees it (task 1.5): an array
 * after 100 items (`"[TRUNCATED: N more items]"`), a string after 1,000
 * characters (`"… [TRUNCATED]"`) and a value nested six levels deep
 * (`"[TRUNCATED: Max depth exceeded]"`). Every marker ends a string.
 */
const TRUNCATION_MARKER = /\[TRUNCATED(?::[^\]]*)?\]$/;

/** The path of the first truncation marker in `value`, or null. */
function truncatedAt(value: unknown, path: string): string | null {
    if (typeof value === "string") {
        return TRUNCATION_MARKER.test(value) ? path : null;
    }
    if (typeof value !== "object" || value === null) {
        return null;
    }
    const entries = Array.isArray(value)
        ? value.map((item, index): [string, unknown] => [`${path}[${index}]`, item])
        : Object.entries(value).map(([key, item]): [string, unknown] => [`${path}.${key}`, item]);
    for (const [at, item] of entries) {
        const found = truncatedAt(item, at);
        if (found !== null) {
            return found;
        }
    }
    return null;
}

export function validateEnvelope(
    raw: unknown,
    collector: string,
    runId: string,
): { ok: true; value: ValidEnvelope } | { ok: false; error: ReadError } {
    return guard(() => {
        const cut = truncatedAt(raw, collector);
        if (cut !== null) {
            return unreadable(`${collector}: javascript_tool truncated the result at ${cut}`);
        }
        const root = object(raw, collector);
        const stonks = string(root, "stonks", collector);
        if (stonks !== `${collector}.v1`) {
            return unreadable(`${collector}: expected ${collector}.v1, found ${stonks}`);
        }
        const run = string(root, "run", collector);
        if (run !== runId) {
            return unreadable(
                `${collector}: result belongs to run ${run}, not the current run ${runId}`,
            );
        }
        const url = string(root, "url", collector);
        if (boolean(root, "loginWall", collector)) {
            return { ok: false, error: { kind: "login-wall" } };
        }
        const data = object(root.data, `${collector}.data`);
        return { ok: true, value: { stonks, run, url, loginWall: false, data } };
    });
}
