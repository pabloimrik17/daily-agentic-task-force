// The `taken` label written and removed with a read-back (design D14): a
// tracker that accepted the command may still have dropped the write, and
// `taken` is the only evidence that a task is taken, so neither direction is
// trusted without reading the task again. Triage's own write keeps its path.

import type { Tracker, TrackerResult } from "../label-triage/trackers/tracker.ts";

export const TAKEN = "taken";

// `labels` is what the read-back found when it contradicted the write; null
// when the command or the read failed, so nothing was found.
export type LabelWrite = { ok: true } | { ok: false; error: string; labels: string[] | null };

async function confirmed(
    tracker: Tracker,
    id: string,
    write: TrackerResult<void>,
    contradicts: (labels: string[]) => string | null,
): Promise<LabelWrite> {
    if (!write.ok) {
        return { ok: false, error: write.error, labels: null };
    }
    const read = await tracker.readTask(id);
    if (!read.ok) {
        return { ok: false, error: read.error, labels: null };
    }
    const labels = read.value.labels;
    const error = contradicts(labels);
    return error === null ? { ok: true } : { ok: false, error, labels };
}

const list = (labels: string[]) => `[${labels.join(", ")}]`;

export async function addTaken(tracker: Tracker, id: string): Promise<LabelWrite> {
    const write = await tracker.addLabel(id, TAKEN);
    return confirmed(tracker, id, write, (labels) =>
        labels.includes(TAKEN)
            ? null
            : `${TAKEN} missing from ${tracker.source}:${id} after add: ${list(labels)}`,
    );
}

export async function removeTaken(tracker: Tracker, id: string): Promise<LabelWrite> {
    const write = await tracker.removeLabel(id, TAKEN);
    return confirmed(tracker, id, write, (labels) =>
        labels.includes(TAKEN)
            ? `${TAKEN} still on ${tracker.source}:${id} after removal: ${list(labels)}`
            : null,
    );
}
