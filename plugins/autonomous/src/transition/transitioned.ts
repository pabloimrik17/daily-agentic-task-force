// The record an applied transition leaves in the open attempt's directory (spec autonomous-run,
// "An applied transition leaves a record in the open attempt"; design D5): the labels the human
// answered and when. The logbook header reads it; no other mode does.

import { readFile } from "node:fs/promises";

import { transitionedPath, writeJsonAtomic } from "../attempts/state.ts";
import type { Result } from "../result.ts";
import {
    type Json,
    object,
    ParseError,
    rejectUnknownKeys,
    string,
    stringArray,
} from "../validate.ts";

export const TRANSITIONED_SCHEMA = "autonomous.transitioned.v1";

export interface Transitioned {
    schema: typeof TRANSITIONED_SCHEMA;
    answer: string[]; // the labels answered, in the order given
    at: string; // ISO time the transition was applied
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

export async function writeTransitioned(
    dir: string,
    answer: readonly string[],
    at: Date,
): Promise<void> {
    const written: Transitioned = {
        schema: TRANSITIONED_SCHEMA,
        answer: [...answer],
        at: at.toISOString(),
    };
    await writeJsonAtomic(transitionedPath(dir), written);
}

function parseTransitioned(input: unknown): Transitioned {
    const root: Json = object(input, "$");
    rejectUnknownKeys(root, ["schema", "answer", "at"], "$");
    if (root.schema !== TRANSITIONED_SCHEMA) {
        throw new ParseError(`$.schema must be ${TRANSITIONED_SCHEMA}`);
    }
    return {
        schema: TRANSITIONED_SCHEMA,
        answer: stringArray(root, "answer", "$"),
        at: string(root, "at", "$"),
    };
}

// Null when the attempt's directory holds no record: a manual transition, or one answered before
// the record existed. An unreadable or malformed file is an error naming it.
export async function readTransitioned(dir: string): Promise<Result<Transitioned | null>> {
    const file = transitionedPath(dir);
    let text: string;
    try {
        text = await readFile(file, "utf8");
    } catch (error) {
        const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
        return missing
            ? { ok: true, value: null }
            : { ok: false, error: `cannot read ${file}: ${messageOf(error)}` };
    }
    let json: unknown;
    try {
        json = JSON.parse(text);
    } catch (error) {
        return { ok: false, error: `${file} is not valid JSON: ${messageOf(error)}` };
    }
    try {
        return { ok: true, value: parseTransitioned(json) };
    } catch (error) {
        return {
            ok: false,
            error: `${file} does not match ${TRANSITIONED_SCHEMA}: ${messageOf(error)}`,
        };
    }
}
