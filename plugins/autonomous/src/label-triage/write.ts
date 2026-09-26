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
            const before = tasks.get(derivation.taskId)?.labels ?? [];
            const outcome = await writeOne(trackers[source], derivation, before);
            if (outcome.ok) {
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

async function writeOne(
    tracker: Tracker,
    derivation: Derivation,
    before: string[],
): Promise<{ ok: true } | { ok: false; error: string; after: string[] | null }> {
    for (const label of derivation.labels) {
        const result = await tracker.addLabel(derivation.taskId, label);
        if (!result.ok) {
            return { ok: false, error: result.error, after: null };
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
            error: `read-back mismatch: before [${before.join(", ")}] + [${derivation.labels.join(", ")}] → after [${after.join(", ")}]`,
            after,
        };
    }
    return { ok: true };
}
