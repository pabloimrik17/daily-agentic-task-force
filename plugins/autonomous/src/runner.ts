import type { RunArgs } from "./args.ts";
import type { ConfigLoad } from "./config.ts";
import type { Exec } from "./exec.ts";
import type { JudgementExec } from "./label-triage/judgement.ts";
import type { TrackerFactory } from "./label-triage/trackers/tracker.ts";

// Provisional contract (design D2): expected to change as further steps land.

export type StepOutcome = "advance" | "wait" | "not-evaluable";

export type StepTier = "code" | "jev" | "llm";

export interface StepResult<D = unknown> {
    step: string;
    tier: StepTier;
    outcome: StepOutcome;
    reasons: string[];
    data: D;
}

export interface RunContext {
    args: RunArgs;
    now: Date;
    config: ConfigLoad;
    io: {
        openUsage: Exec;
        trackers: TrackerFactory;
        judgement: JudgementExec;
    };
}

export interface Step<D = unknown> {
    id: string;
    run(ctx: RunContext): Promise<StepResult<D>>;
    render(result: StepResult<D>): string;
}

export interface RunResult {
    results: StepResult[];
    outcome: StepOutcome;
}

export async function runSteps(steps: readonly Step[], ctx: RunContext): Promise<RunResult> {
    const results: StepResult[] = [];
    for (const step of steps) {
        const result = await step.run(ctx);
        results.push(result);
        if (result.outcome !== "advance") {
            return { results, outcome: result.outcome };
        }
    }
    return { results, outcome: "advance" };
}
