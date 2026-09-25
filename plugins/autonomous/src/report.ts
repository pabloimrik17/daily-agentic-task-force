import type { RunResult, Step, StepOutcome, StepResult } from "./runner.ts";

export interface RunReport {
    schema: "autonomous.run.v1";
    startedAt: string;
    steps: StepResult[];
    outcome: StepOutcome;
    // Reserved for steps that need an agent to act; never emitted yet.
    handoff?: unknown;
}

export function buildReport(startedAt: Date, run: RunResult): RunReport {
    return {
        schema: "autonomous.run.v1",
        startedAt: startedAt.toISOString(),
        steps: run.results,
        outcome: run.outcome,
    };
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
    return [header, ...sections].join("\n\n");
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
