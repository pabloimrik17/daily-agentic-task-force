// Pieces the three context readers share (spec proposal-stage, "The run gathers the task's
// context"): the empty context, and the note a list a CLI did not print leaves behind.

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

// The part of a task id after its last `#`, and the part before it.
export function splitGithubId(id: string): { repository: string; number: string } {
    const hash = id.lastIndexOf("#");
    return { repository: id.slice(0, hash), number: id.slice(hash + 1) };
}
