import type { RunArgs } from "../args.ts";
import type { AttemptId, AttemptState } from "../attempts/record.ts";
import type { ReconciledAttempt, ReconcileData } from "../attempts/reconcile.ts";
import type { AutonomousConfig } from "../config.ts";
import { config } from "../label-triage/test-fixtures.ts";
import { context } from "../quota-gate/test-fixtures.ts";
import type { RunContext, StepResult } from "../runner.ts";

export function attempt(
    id: AttemptId,
    state: AttemptState = "started",
    parts: Partial<ReconciledAttempt> = {},
): ReconciledAttempt {
    return {
        id,
        before: state,
        state,
        session: null,
        marker: null,
        action: "none",
        detail: null,
        stageNow: null,
        ...parts,
    };
}

// The result of `reconcile` as the capacity step reads it.
function reconciled(
    attempts: ReconciledAttempt[],
    cleanups: AttemptId[] = [],
): StepResult<ReconcileData> {
    return {
        step: "reconcile",
        tier: "code",
        outcome: "advance",
        reasons: [],
        data: { attempts, retained: [], cleanups, needsHuman: [], errors: [] },
    };
}

interface Options {
    attempts?: ReconciledAttempt[];
    cleanups?: AttemptId[];
    args?: Partial<RunArgs>;
    config?: AutonomousConfig;
    defaulted?: string[];
}

// Limits of the shipped defaults (1 grill, 2 work) unless the options say otherwise.
export function capacityContext(options: Options = {}): RunContext {
    const base = context(() => Promise.reject(new Error("capacity reads no OpenUsage")), {
        ...options.args,
    });
    return {
        ...base,
        config: {
            ok: true,
            path: "/home/me/.config/autonomous/config.json",
            config: options.config ?? config(),
            defaulted: options.defaulted ?? [],
        },
        results: [reconciled(options.attempts ?? [], options.cleanups)],
    };
}
