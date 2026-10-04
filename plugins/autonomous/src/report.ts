import type { RunArgs } from "./args.ts";
import type { HandoffQuestion, RunResult, Step, StepOutcome, StepResult } from "./runner.ts";

// What the run asks the agent that ran the command to do next (design D1).
interface Handoff {
    questions: HandoffQuestion[];
    remaining: number; // contributed questions left out by the cap
}

export interface RunReport {
    schema: "autonomous.run.v1";
    startedAt: string;
    steps: StepResult[];
    outcome: StepOutcome;
    handoff?: Handoff;
}

// One AskUserQuestion round takes at most 4 questions: a limit of the tool, not a setting.
const MAX_QUESTIONS = 4;

export function buildReport(
    startedAt: Date,
    run: RunResult,
    args: Pick<RunArgs, "apply" | "noHandoff">,
): RunReport {
    const report: RunReport = {
        schema: "autonomous.run.v1",
        startedAt: startedAt.toISOString(),
        steps: run.results,
        outcome: run.outcome,
    };
    if (args.apply && !args.noHandoff && run.questions.length > 0) {
        report.handoff = {
            questions: run.questions.slice(0, MAX_QUESTIONS),
            remaining: Math.max(0, run.questions.length - MAX_QUESTIONS),
        };
    }
    return report;
}

export function renderJson(report: RunReport): string {
    return JSON.stringify(report, null, 2);
}

export function renderText(report: RunReport, steps: readonly Step[]): string {
    const sections = report.steps.map((result) => {
        const step = steps.find((candidate) => candidate.id === result.step);
        return step ? step.render(result) : renderGeneric(result);
    });
    const header = `autonomous run — started ${report.startedAt}\noutcome: ${report.outcome}`;
    // Design D2: the handoff travels as the last line, one JSON document the command reads back.
    const handoff =
        report.handoff === undefined ? [] : [`handoff: ${JSON.stringify(report.handoff)}`];
    return [header, ...sections, ...handoff].join("\n\n");
}

function renderGeneric(result: StepResult): string {
    return [
        `[${result.step}] ${result.outcome} (${result.tier})`,
        ...result.reasons.map((r) => `  - ${r}`),
    ].join("\n");
}

const EXIT_CODES: Record<StepOutcome, number> = {
    advance: 0,
    wait: 2,
    "not-evaluable": 3,
};

export const USAGE_EXIT_CODE = 1;

export function exitCodeFor(outcome: StepOutcome): number {
    return EXIT_CODES[outcome];
}
