import type { ReconciledAttempt, ReconcileData } from "../attempts/reconcile.ts";
import type { RunReport } from "../report.ts";
import type { StepOutcome, StepResult } from "../runner.ts";

export const NOW = new Date("2026-11-14T09:00:00.000Z");

// A pid no process holds, as in the lock tests.
export const DEAD = 2 ** 22;

export function attempt(overrides: Partial<ReconciledAttempt> = {}): ReconciledAttempt {
    return {
        id: "linear:DOT-98:grill-me:1",
        before: "started",
        state: "started",
        session: { state: "open", status: "running", busy: true, needsHuman: false },
        marker: null,
        action: "observed",
        detail: null,
        stageNow: null,
        ...overrides,
    };
}

export function reconciled(attempts: ReconciledAttempt[]): StepResult<ReconcileData> {
    return {
        step: "reconcile",
        tier: "code",
        outcome: "advance",
        reasons: [],
        data: { attempts, retained: [], cleanups: [], needsHuman: [], errors: [] },
    };
}

export function report(
    outcome: StepOutcome,
    steps: StepResult[] = [],
    startedAt: Date = NOW,
): RunReport {
    return { schema: "autonomous.run.v2", startedAt: startedAt.toISOString(), steps, outcome };
}
