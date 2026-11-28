import { vi } from "vitest";
import type { Exec } from "../exec.ts";
import { workTask } from "../select/test-fixtures.ts";
import { emptyContext } from "./shared.ts";
import type { TrackerResult } from "../label-triage/trackers/tracker.ts";
import type { TaskContext } from "./types.ts";

export function execPrinting(output: unknown) {
    return vi.fn<Exec>().mockResolvedValue({ ok: true, stdout: JSON.stringify(output) });
}

export function execFailing(error: string) {
    return vi.fn<Exec>().mockResolvedValue({ ok: false, error });
}

export const linearTask = workTask("linear", "DEMO-110");
export const beadsTask = workTask("beads", "demo-1.7");
export const githubTask = workTask("github", "demo/one#10", ["personal", "proposal"]);

export function context(overrides: Partial<TaskContext> = {}): TaskContext {
    return { ...emptyContext(), ...overrides };
}

export function valueOf(result: TrackerResult<TaskContext>): TaskContext {
    if (!result.ok) throw new Error(result.error);
    return result.value;
}
