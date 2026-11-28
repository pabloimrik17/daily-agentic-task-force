// Who wrote a comment (design D2, D7): GraphQL names a bot without the `[bot]` suffix REST gives
// it, and a hidden marker, not the author, tells an external review's reply from anyone's comment.

import { parseAttemptId } from "../attempts/record.ts";
import { parseMarkers } from "../publish/markers.ts";
import type { ReviewBot } from "./types.ts";

const BOT_SUFFIX = "[bot]";

export function bareLogin(login: string): string {
    return login.endsWith(BOT_SUFFIX) ? login.slice(0, -BOT_SUFFIX.length) : login;
}

export function botOf(author: string, bots: readonly ReviewBot[]): ReviewBot | null {
    const bare = bareLogin(author);
    return bots.find(({ login }) => bareLogin(login) === bare) ?? null;
}

// The attempt of the external review that wrote the comment as a reply, or null.
export function externalReviewReply(body: string): { attempt: string; state: string } | null {
    for (const marker of parseMarkers(body)) {
        if (
            marker.kind === "resolution" &&
            parseAttemptId(marker.attempt)?.stage === "external-review"
        ) {
            return { attempt: marker.attempt, state: marker.state };
        }
    }
    return null;
}
