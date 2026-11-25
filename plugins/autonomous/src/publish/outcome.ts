// What is published and in which state (spec finding-threads, "Only surviving findings are
// published", "A thread's state follows the finding's outcome" and "A finding passed on is
// addressed to its stage"; design D12).

import type { FindingEntry, PublicationState, RecordEntry } from "./record.ts";

export type ThreadState = "open" | "resolved";

export interface Published {
    state: ThreadState;
    status: string; // the status line, without its `Status: ` prefix
    label: "issue" | "suggestion" | "question"; // Conventional Comments
    blocking: boolean;
    publication: PublicationState; // the resolution marker's `state=`
    for?: string; // the stage a finding passed on is addressed to
}

const STAGE_NAMES: Readonly<Record<string, string>> = {
    qa: "QA",
    verify: "verification",
    "code-review": "code review",
};

export function stageName(stage: string): string {
    return STAGE_NAMES[stage] ?? stage;
}

function survives(entry: FindingEntry): boolean {
    const { destination, refutation, severity, publication } = entry;
    if (publication.state === "fixed" && severity === "SUGGESTION") {
        return false;
    }
    return refutation.outcome === "survived"
        ? destination === "fix" || destination === "defer"
        : refutation.outcome === "not-refuted" && destination === "pass-on";
}

type Placement = Pick<Published, "state" | "status" | "for">;

function placement(entry: FindingEntry): Placement | null {
    const { publication } = entry;
    switch (publication.state) {
        case "fixed":
            return { state: "resolved", status: `fixed in ${publication.commit}` };
        case "deferred":
            return "followUp" in publication
                ? { state: "resolved", status: `deferred to ${publication.followUp}` }
                : {
                      state: "open",
                      status: `deferred: follow-up proposed, "${publication.proposedTitle}"`,
                  };
        case "passed-on":
            return {
                state: "open",
                status: `passed on to ${stageName(publication.stage)} #${publication.stage}`,
                for: publication.stage,
            };
        case "blocked":
            return { state: "open", status: `blocked: ${publication.reason}` };
        default:
            return null;
    }
}

// Null when the entry is not published: a refuted, dismissed or fixed-SUGGESTION finding, or a
// doubt the record does not mark for publication.
export function publicationOf(entry: RecordEntry): Published | null {
    if (entry.kind === "doubt") {
        return entry.destination === "publish"
            ? {
                  state: "open",
                  status: "open question",
                  label: "question",
                  blocking: true,
                  publication: entry.publication.state,
              }
            : null;
    }
    const placed = survives(entry) ? placement(entry) : null;
    if (placed === null) {
        return null;
    }
    return {
        ...placed,
        label: entry.label,
        blocking: entry.severity === "CRITICAL",
        publication: entry.publication.state,
    };
}
