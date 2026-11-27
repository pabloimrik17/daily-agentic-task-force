// What is published and in which state (spec finding-threads, "Only surviving findings are
// published", "A thread's state follows the finding's outcome", "A finding passed on is
// addressed to its stage" and "Existing threads are answered, never duplicated"; design D12).

import type { FindingEntry, PublicationState, RecordEntry } from "./record.ts";

export type ThreadState = "open" | "resolved";

export interface Published {
    state: ThreadState | "kept"; // "kept": an entry not published, whose linked thread keeps its state
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

function survivesRefutation({ destination, refutation }: FindingEntry): boolean {
    return refutation.outcome === "survived"
        ? destination === "fix" || destination === "defer"
        : refutation.outcome === "not-refuted" && destination === "pass-on";
}

function survives(entry: FindingEntry): boolean {
    const { severity, publication } = entry;
    return (
        !(publication.state === "fixed" && severity === "SUGGESTION") && survivesRefutation(entry)
    );
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
    return placed === null ? null : placedFinding(entry, placed);
}

function placedFinding(entry: FindingEntry, placed: Placement): Published {
    return {
        ...placed,
        label: entry.label,
        blocking: entry.severity === "CRITICAL",
        publication: entry.publication.state,
    };
}

const DOUBT_WORDS = { settled: "settled", ask: "asked", publish: null } as const;

// Why the record does not publish the entry, in the status line's words.
function notPublishedAs(entry: RecordEntry): string | null {
    if (entry.kind === "doubt") {
        return DOUBT_WORDS[entry.destination];
    }
    if (entry.refutation.outcome === "refuted") {
        return "refuted";
    }
    return entry.destination === "dismiss" ? "dismissed" : null;
}

// The reply for a refuted or dismissed finding or a settled doubt linked to a thread: its outcome
// and the record's reason, with the thread's state left as it is.
function unpublished(entry: RecordEntry): Published {
    const as = notPublishedAs(entry);
    const reason = entry.reason.split(/\s+/u).filter(Boolean).join(" ");
    return {
        state: "kept",
        status: `not published${as === null ? "" : ` (${as})`}: ${reason}`,
        label: entry.kind === "doubt" ? "question" : entry.label,
        blocking: entry.kind === "doubt" || entry.severity === "CRITICAL",
        publication: entry.publication.state,
    };
}

// A finding that survived the refutation but is not published, a fixed `SUGGESTION`, is answered
// in its thread as it stands: `fixed in <commit>`, resolved.
function linkedOutcome(entry: RecordEntry): Published {
    const placed = entry.kind === "finding" && survivesRefutation(entry) ? placement(entry) : null;
    return entry.kind === "finding" && placed !== null
        ? placedFinding(entry, placed)
        : unpublished(entry);
}

// What publish mode answers in the entry's thread: its publication, or, for a linked entry that
// is not published, its outcome. Null for an unpublished entry with no linked thread, which
// posts nothing.
export function outcomeOf(entry: RecordEntry): Published | null {
    return publicationOf(entry) ?? (entry.thread === null ? null : linkedOutcome(entry));
}
