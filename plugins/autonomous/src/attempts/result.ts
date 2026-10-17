// The result marker (spec stage-sessions, "Completion needs two proofs";
// design D7): the file an agent writes to say its stage is done. It counts
// only when it parses, names this attempt and reports `completed`; anything
// else counts as absent, with the reason for the report.

import { readFile } from "node:fs/promises";

import { array, type Json, object, ParseError, rejectUnknownKeys, string } from "../validate.ts";

export const RESULT_SCHEMA = "autonomous.result.v1";

export interface ResultMarker {
    schema: typeof RESULT_SCHEMA;
    attempt: string;
    outcome: "completed";
    summary: string;
    artifacts: string[];
    finishedAt: string;
}

export type MarkerRead = { ok: true; marker: ResultMarker } | { ok: false; reason: string };

interface RawMarker {
    attempt: string;
    outcome: string;
    summary: string;
    artifacts: string[];
    finishedAt: string;
}

function parseRaw(input: unknown): RawMarker {
    const root = object(input, "$");
    rejectUnknownKeys(
        root,
        ["schema", "attempt", "outcome", "summary", "artifacts", "finishedAt"],
        "$",
    );
    if (string(root, "schema", "$") !== RESULT_SCHEMA) {
        throw new ParseError(`$.schema must be ${RESULT_SCHEMA}`);
    }
    return {
        attempt: string(root, "attempt", "$"),
        outcome: string(root, "outcome", "$"),
        summary: string(root, "summary", "$"),
        artifacts: strings(root),
        finishedAt: string(root, "finishedAt", "$"),
    };
}

function strings(root: Json): string[] {
    return array(root.artifacts, "$.artifacts").map((value, index) => {
        if (typeof value !== "string") {
            throw new ParseError(`$.artifacts[${index}] must be a string`);
        }
        return value;
    });
}

function absent(reason: string): MarkerRead {
    return { ok: false, reason };
}

function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

async function readText(file: string): Promise<{ text: string } | MarkerRead> {
    try {
        return { text: await readFile(file, "utf8") };
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            return absent("no result marker");
        }
        return absent(`result marker is unreadable: ${messageOf(error)}`);
    }
}

function parseText(text: string): { raw: RawMarker } | MarkerRead {
    let json: unknown;
    try {
        json = JSON.parse(text);
    } catch (error) {
        return absent(`result marker is not valid JSON: ${messageOf(error)}`);
    }
    try {
        return { raw: parseRaw(json) };
    } catch (error) {
        return absent(`result marker does not match ${RESULT_SCHEMA}: ${messageOf(error)}`);
    }
}

export async function readMarker(file: string, attemptId: string): Promise<MarkerRead> {
    const read = await readText(file);
    if (!("text" in read)) {
        return read;
    }
    const parsed = parseText(read.text);
    if (!("raw" in parsed)) {
        return parsed;
    }
    const { raw } = parsed;
    if (raw.attempt !== attemptId) {
        return absent(`result marker names attempt ${raw.attempt}, expected ${attemptId}`);
    }
    if (raw.outcome !== "completed") {
        return absent(`result marker outcome is "${raw.outcome}", expected "completed"`);
    }
    return { ok: true, marker: { schema: RESULT_SCHEMA, ...raw, outcome: "completed" } };
}
