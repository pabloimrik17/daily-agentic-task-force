import type { Answer, RunArgs } from "./args.ts";
import type { AutonomousConfig, ConfigLoad } from "./config.ts";
import type { Exec } from "./exec.ts";
import type { JudgementExec } from "./label-triage/judgement.ts";
import type { TrackerFactory, Trackers } from "./label-triage/trackers/tracker.ts";
import type { SelectionExec, WorkReaderFactory } from "./select/types.ts";

// Provisional contract (design D2): expected to change as further steps land.

export type StepOutcome = "advance" | "wait" | "not-evaluable";

export type StepTier = "code" | "jev" | "llm";

// A question for the human (handoff design D1), composed entirely by the step
// that contributes it. The command passes it on verbatim and only maps the
// chosen labels back to their values.
export interface HandoffOption {
    label: string;
    value: string | null; // null: no answer for now, never passed back
    description: string;
}

export interface HandoffQuestion {
    id: string; // "<step>:<target>", opaque to the command
    step: string;
    header: string; // at most 12 characters
    question: string;
    options: HandoffOption[]; // 2 to 4, exactly one with a null value
    multiSelect: boolean;
}

export interface StepResult<D = unknown> {
    step: string;
    tier: StepTier;
    outcome: StepOutcome;
    reasons: string[];
    data: D;
    questions?: HandoffQuestion[]; // moved into RunResult.questions by runSteps
}

export interface RunContext {
    args: RunArgs;
    now: Date;
    config: ConfigLoad;
    results: readonly StepResult[]; // the steps that already ran, in order (design D1)
    io: {
        openUsage: Exec;
        trackers: TrackerFactory;
        judgement: JudgementExec;
        chezmoi: Exec;
        work: WorkReaderFactory;
        selection: SelectionExec;
    };
}

export type AnswerStatus = "applied" | "skipped" | "rejected" | "failed";

export interface AnswerRecord {
    id: string;
    labels: string[];
    status: AnswerStatus;
    detail: string;
}

export interface AnswerContext {
    config: AutonomousConfig;
    trackers: Trackers;
}

export interface Step<D = unknown> {
    id: string;
    run(ctx: RunContext): Promise<StepResult<D>>;
    render(result: StepResult<D>): string;
    // Answer mode (design D3): validates and applies the answers to this step's
    // own questions, one record per answer.
    answer?(answers: readonly Answer[], ctx: AnswerContext): Promise<AnswerRecord[]>;
}

export interface RunResult {
    results: StepResult[];
    questions: HandoffQuestion[]; // every executed step's, in step order
    outcome: StepOutcome;
}

export async function runSteps(steps: readonly Step[], ctx: RunContext): Promise<RunResult> {
    const results: StepResult[] = [];
    const questions: HandoffQuestion[] = [];
    for (const step of steps) {
        const { questions: contributed = [], ...result } = await step.run({
            ...ctx,
            results: [...results],
        });
        results.push(result);
        questions.push(...contributed);
        if (result.outcome !== "advance") {
            return { results, questions, outcome: result.outcome };
        }
    }
    return { results, questions, outcome: "advance" };
}
