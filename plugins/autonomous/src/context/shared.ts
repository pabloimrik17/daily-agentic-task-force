import { type Json, string } from "../validate.ts";
import type { TaskContext } from "./types.ts";

export function emptyContext(): TaskContext {
    return {
        comments: [],
        parent: null,
        children: [],
        blockedBy: [],
        blocks: [],
        related: [],
        duplicates: [],
        project: null,
        attachments: [],
        pullRequests: [],
        notes: [],
    };
}

export function absent(value: unknown): boolean {
    return value === undefined || value === null;
}

// A string field that may be absent or null.
export function nullableString(entry: Json, key: string, path: string): string | null {
    return absent(entry[key]) ? null : string(entry, key, path);
}
