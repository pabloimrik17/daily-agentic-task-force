// GitHub does not show this first line of an entry: it ties a comment to its attempt, so neither
// log mode nor discard publishes a second entry for one.

import type { AttemptId } from "../attempts/record.ts";

export const LOGGED_SCHEMA = "autonomous.logged.v1";

export function logbookMarker(attempt: AttemptId): string {
    return `<!-- autonomous:logbook ${attempt} -->`;
}

export function hasEntry(comments: readonly string[], attempt: AttemptId): boolean {
    const marker = logbookMarker(attempt);
    return comments.some((body) => body.trimStart().startsWith(marker));
}
