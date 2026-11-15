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
