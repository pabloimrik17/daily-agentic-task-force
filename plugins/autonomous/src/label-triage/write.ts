// Additive writes with read-back (spec label-triage, "Write only with
// --apply, additively, with read-back"): every write adds labels, never
// replaces or removes them, and is verified by reading the task back. A
// write error or a read-back mismatch stops writes to that source for the
// rest of the run; the other sources keep going.

import type { Source } from "../config.ts";
import type { Derivation } from "./rules.ts";
import type { Tracker, TrackerTask, Trackers } from "./trackers/tracker.ts";

export type RecordStatus = "applied" | "proposed" | "asked" | "failed";

export interface TriageRecord extends Derivation {
    status: RecordStatus;
    detail: string | null; // decide reason for asked; write failure text for failed
}

export interface WriteFailure {
    source: Source;
    taskId: string;
    labels: string[];
    before: string[];
    after: string[] | null; // null when readTask failed
    error: string;
}

const SOURCE_ORDER: readonly Source[] = ["beads", "github", "linear"];

// Prefix of the error a read-back mismatch reports; the report renders it apart.
export const READ_BACK_MISMATCH = "read-back mismatch";

export function taskKey(source: Source, id: string): string {
    return `${source}:${id}`;
}

export async function applyDerivations(
    eligible: Derivation[],
    tasks: Map<string, TrackerTask>,
    trackers: Trackers,
    apply: boolean,
): Promise<{ records: TriageRecord[]; failures: WriteFailure[] }> {
    if (!apply) {
        return {
            records: eligible.map((derivation) => ({
                ...derivation,
                status: "proposed",
                detail: null,
            })),
            failures: [],
        };
    }

    const records: TriageRecord[] = [];
    const failures: WriteFailure[] = [];
    // The listing's labels plus those this run has added, so a task's second derivation
    // expects the first one's labels in its read-back.
    const known = new Map<string, string[]>();
    for (const source of SOURCE_ORDER) {
        let stopped = false;
        for (const derivation of eligible.filter((d) => d.source === source)) {
            if (stopped) {
                records.push({
                    ...derivation,
                    status: "proposed",
                    detail: `skipped after a write failure on ${source}`,
                });
                continue;
            }
            const key = taskKey(source, derivation.taskId);
            const before = known.get(key) ?? tasks.get(key)?.labels ?? [];
            const outcome = await writeOne(trackers[source], derivation, before);
            if (outcome.ok) {
                const added = derivation.labels.filter((label) => !before.includes(label));
                known.set(key, [...before, ...added]);
                records.push({ ...derivation, status: "applied", detail: null });
            } else {
                records.push({ ...derivation, status: "failed", detail: outcome.error });
                failures.push({
                    source,
                    taskId: derivation.taskId,
                    labels: derivation.labels,
                    before,
                    after: outcome.after,
                    error: outcome.error,
                });
                stopped = true;
            }
        }
    }
    return { records, failures };
}

// A write cut short leaves the human-facing labels behind: grill-me, then HITL, land
// before the rest, AFK last.
function writeRank(label: string): number {
    if (label === "grill-me") {
        return 0;
    }
    if (label === "HITL") {
        return 1;
    }
    return label === "AFK" ? 3 : 2;
}

async function writeOne(
    tracker: Tracker,
    derivation: Derivation,
    before: string[],
): Promise<{ ok: true } | { ok: false; error: string; after: string[] | null }> {
    const labels = [...derivation.labels].sort((a, b) => writeRank(a) - writeRank(b));
    for (const [index, label] of labels.entries()) {
        const result = await tracker.addLabel(derivation.taskId, label);
        if (!result.ok) {
            if (index === 0) {
                return { ok: false, error: result.error, after: null };
            }
            const read = await tracker.readTask(derivation.taskId);
            return { ok: false, error: result.error, after: read.ok ? read.value.labels : null };
        }
    }
    const read = await tracker.readTask(derivation.taskId);
    if (!read.ok) {
        return { ok: false, error: read.error, after: null };
    }
    const after = read.value.labels;
    const afterSet = new Set(after);
    const expected = [...before, ...derivation.labels];
    if (!expected.every((label) => afterSet.has(label))) {
        return {
            ok: false,
            error: `${READ_BACK_MISMATCH}: before [${before.join(", ")}] + [${derivation.labels.join(", ")}] → after [${after.join(", ")}]`,
            after,
        };
    }
    return { ok: true };
}
