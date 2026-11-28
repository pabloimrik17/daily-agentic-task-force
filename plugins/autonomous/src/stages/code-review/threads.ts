// Spec code-review-stage, "Finding threads read at launch"; design D10.

import { parseAttemptId } from "../../attempts/record.ts";
import type { DiffSide, ReviewThread } from "../../pull-request/port.ts";
import { parseMarkers, renderMarker, threadMarker } from "../../publish/markers.ts";
import { type Check, contextValue, requiredPullRequest } from "../openspec-stage.ts";
import type { StageContext } from "../stage.ts";

export const THREADS_KEY = "findingThreads";

const STAGE = "code-review";

// `published`: a code review published it, open or resolved; `addressed`: an open thread another
// stage passed on to code review.
type ThreadGroup = "published" | "addressed";

interface ListedThread {
    group: ThreadGroup;
    id: string; // GraphQL node id, what a record entry's `thread` names
    url: string;
    resolved: boolean;
    location: string;
    heading: string;
    markers: string[];
}

function groupOf(thread: ReviewThread): ThreadGroup | null {
    const marker = threadMarker(thread.comments[0]?.body ?? "");
    if (marker === null) {
        return null;
    }
    if (parseAttemptId(marker.attempt)?.stage === STAGE) {
        return "published";
    }
    return marker.for === STAGE && !thread.resolved ? "addressed" : null;
}

const SIDES: Record<DiffSide, string> = { RIGHT: "new side", LEFT: "old side" };

export function locationOf({ path, subjectType, line, startLine, side }: ReviewThread): string {
    if (subjectType === "FILE") {
        return `\`${path}\`, file level`;
    }
    if (line === null) {
        return `\`${path}\`, no longer placed on the diff`;
    }
    const lines =
        startLine === null || startLine === line ? `line ${line}` : `lines ${startLine}-${line}`;
    return side === null ? `\`${path}\`, ${lines}` : `\`${path}\`, ${lines}, ${SIDES[side]}`;
}

function listed(thread: ReviewThread): ListedThread[] {
    const group = groupOf(thread);
    if (group === null) {
        return [];
    }
    return [
        {
            group,
            id: thread.id,
            url: thread.comments[0]?.url ?? "",
            resolved: thread.resolved,
            location: locationOf(thread),
            heading: (thread.comments[0]?.body ?? "").split(/\r?\n/)[0]?.trim() ?? "",
            markers: thread.comments.flatMap(({ body }) => parseMarkers(body).map(renderMarker)),
        },
    ];
}

// A pull request whose threads cannot be read fails the prerequisites: the triage could not link
// a finding to the thread an earlier attempt published.
export const findingThreads: Check = async ({ readers }, read) => {
    const { number } = requiredPullRequest(read, STAGE);
    const threads = await readers.pullRequests.threads(number);
    if (!threads.ok) {
        return {
            ok: false,
            error: `cannot read the review threads of pull request #${number}: ${threads.error}`,
        };
    }
    return { ok: true, value: { [THREADS_KEY]: JSON.stringify(threads.value.flatMap(listed)) } };
};

function threadLine({ id, url, resolved, location, heading, markers }: ListedThread): string {
    const state = resolved ? "resolved" : "open";
    const marks = markers.map((marker) => `\`${marker}\``).join(", ");
    return `- \`${id}\`, ${state}, at ${location}: "${heading}"; markers ${marks}; ${url}`;
}

function group(threads: readonly ListedThread[], which: ThreadGroup, none: string): string[] {
    const lines = threads.filter((thread) => thread.group === which).map(threadLine);
    return lines.length === 0 ? [none] : lines;
}

export function threadLines(context: StageContext): string[] {
    const threads = JSON.parse(contextValue(context, STAGE, THREADS_KEY)) as ListedThread[];
    return [
        "#### Threads a code review published",
        "",
        ...group(threads, "published", "None: no code review has published a thread here yet."),
        "",
        "#### Findings passed on to code review",
        "",
        ...group(threads, "addressed", "None: no open thread is addressed to code review."),
    ];
}
