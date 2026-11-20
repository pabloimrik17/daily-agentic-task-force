import { readFile } from "node:fs/promises";

import { type AttemptRecord, holdsTask, type TaskRef } from "../attempts/record.ts";
import { attemptDir, listRecords, transitionedPath, writeJsonAtomic } from "../attempts/state.ts";
import type { Result } from "../result.ts";
import type { StageId } from "../stages/stage.ts";
import {
    type Json,
    object,
    optional,
    ParseError,
    rejectUnknownKeys,
    string,
    stringArray,
} from "../validate.ts";

export const TRANSITIONED_SCHEMA = "autonomous.transitioned.v1";

// Who decided the transition: a human's answer, or the agent of an AFK task leaving proposal
// or implement.
export type TransitionedBy = "agent" | "human";

export interface Transitioned {
    schema: typeof TRANSITIONED_SCHEMA;
    answer: string[];
    at: string;
    // Absent from the records written before it existed.
    by?: TransitionedBy;
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

export async function writeTransitioned(
    dir: string,
    answer: readonly string[],
    at: Date,
    by?: TransitionedBy,
): Promise<void> {
    const written: Transitioned = {
        schema: TRANSITIONED_SCHEMA,
        answer: [...answer],
        at: at.toISOString(),
        ...(by === undefined ? {} : { by }),
    };
    await writeJsonAtomic(transitionedPath(dir), written);
}

export interface TransitionedIn {
    state: string;
    ref: TaskRef;
    from: StageId;
    answer: readonly string[];
    by: TransitionedBy;
    at: Date;
}

// The record goes to the task's open attempt of the stage left; none leaves no record. Returns
// why it could not be written, or null.
export async function recordTransition(input: TransitionedIn): Promise<string | null> {
    const { state, ref, from, answer, by, at } = input;
    try {
        const open = (await listRecords(state)).filter((record) => opens(record, ref));
        const chosen = open.find((record) => record.stage === from);
        if (chosen !== undefined) {
            await writeTransitioned(attemptDir(state, chosen.id), answer, at, by);
        }
        return null;
    } catch (error) {
        return messageOf(error);
    }
}

const opens = (record: AttemptRecord, ref: TaskRef) =>
    record.task.source === ref.source && record.task.id === ref.id && holdsTask(record);

function byValue(parent: Json, key: string, path: string): TransitionedBy {
    const value = string(parent, key, path);
    if (value !== "agent" && value !== "human") {
        throw new ParseError(`${path}.${key} must be agent or human`);
    }
    return value;
}

function parseTransitioned(input: unknown): Transitioned {
    const root: Json = object(input, "$");
    rejectUnknownKeys(root, ["schema", "answer", "at", "by"], "$");
    if (root.schema !== TRANSITIONED_SCHEMA) {
        throw new ParseError(`$.schema must be ${TRANSITIONED_SCHEMA}`);
    }
    const by = optional(root, "by", "$", byValue);
    return {
        schema: TRANSITIONED_SCHEMA,
        answer: stringArray(root, "answer", "$"),
        at: string(root, "at", "$"),
        ...(by === undefined ? {} : { by }),
    };
}

// Null when the attempt's directory holds no record: a manual transition, or one answered before
// the record existed.
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
