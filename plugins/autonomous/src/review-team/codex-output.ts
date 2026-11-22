// The TypeScript validator of the shape in `codex-output.schema.json`, the
// JSON Schema given to `codex exec review --output-schema` (design D4). It
// maps Codex's items onto the schema's own `RawItem`, with the priority as the
// native severity. A test runs the same fixtures through both, so the two
// cannot disagree on shape; this one also checks what a JSON Schema cannot
// say (a non-empty title, a line range that makes sense, a relative path).

import type { Result } from "../result.ts";
import {
    array,
    type Json,
    number,
    object,
    ParseError,
    rejectUnknownKeys,
    string,
} from "../validate.ts";
import { choice, location, nonEmpty, oneLine, toResult } from "./schema.ts";
import { SEVERITY_TABLES } from "./severity.ts";
import type { Location, RawItem } from "./types.ts";

const DOUBT_KEYS = ["title", "statement", "file", "startLine", "endLine"];
const FINDING_KEYS = [...DOUBT_KEYS, "evidence", "priority", "label", "suggestedFix"];

function nullable<T>(
    parent: Json,
    key: string,
    path: string,
    read: (parent: Json, key: string, path: string) => T,
): T | null {
    if (!(key in parent)) {
        throw new ParseError(`${path}.${key} must be present, as a value or null`);
    }
    return parent[key] === null ? null : read(parent, key, path);
}

// File null is a change; a file alone is a file; a file with both lines is a
// line on the new side. Lines without a file, or one line alone, are errors.
function placement(parent: Json, path: string): Location {
    const file = nullable(parent, "file", path, string);
    const startLine = nullable(parent, "startLine", path, number);
    const endLine = nullable(parent, "endLine", path, number);
    if (file === null && (startLine !== null || endLine !== null)) {
        throw new ParseError(`${path}.file must be set when startLine or endLine is`);
    }
    if ((startLine === null) !== (endLine === null)) {
        throw new ParseError(`${path}.startLine and ${path}.endLine must both be set or both null`);
    }
    const candidate =
        file === null
            ? { scope: "change" }
            : startLine === null
              ? { scope: "file", file }
              : { scope: "line", file, startLine, endLine, side: "new" };
    return location(candidate, path);
}

function item(value: unknown, path: string, kind: "finding" | "doubt"): RawItem {
    const parent = object(value, path);
    const base = {
        title: oneLine(parent, "title", path),
        statement: nonEmpty(parent, "statement", path),
        location: placement(parent, path),
    };
    if (kind === "doubt") {
        rejectUnknownKeys(parent, DOUBT_KEYS, path);
        return { kind, ...base, label: "question" };
    }
    rejectUnknownKeys(parent, FINDING_KEYS, path);
    const suggestedFix = nullable(parent, "suggestedFix", path, nonEmpty) ?? undefined;
    return {
        kind,
        ...base,
        evidence: nonEmpty(parent, "evidence", path),
        label: choice(parent, "label", path, ["issue", "suggestion"]),
        nativeSeverity: choice(parent, "priority", path, Object.keys(SEVERITY_TABLES.codex)),
        ...(suggestedFix === undefined ? {} : { suggestedFix }),
    };
}

function items(parent: Json, key: string, kind: "finding" | "doubt"): RawItem[] {
    return array(parent[key], `$.${key}`).map((entry, index) =>
        item(entry, `$.${key}[${index}]`, kind),
    );
}

function codexOutput(input: unknown): RawItem[] {
    const parent = object(input, "$");
    rejectUnknownKeys(parent, ["findings", "doubts"], "$");
    return [...items(parent, "findings", "finding"), ...items(parent, "doubts", "doubt")];
}

export function parseCodexOutput(input: unknown): Result<RawItem[]> {
    return toResult(() => codexOutput(input));
}
