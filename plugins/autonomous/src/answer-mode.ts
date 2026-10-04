// Answer mode (spec autonomous-run, "Answer mode"; handoff design D3): each
// answer goes to the step its id names, and that step validates and applies
// it. Routing is all this module decides: an answer to a step that takes none
// is rejected here, and every other status comes from the step itself.

import type { Answer } from "./args.ts";
import type { AnswerContext, AnswerRecord, Step } from "./runner.ts";

interface AnswersReport {
    schema: "autonomous.answers.v1";
    startedAt: string;
    outcome: "advance" | "not-evaluable";
    answers: AnswerRecord[];
    // Present only when the configuration failed to load, leaving no answers.
    config?: { path: string; error: string };
}

type AnsweringStep = Step & Required<Pick<Step, "answer">>;

const answering = (step: Step): step is AnsweringStep => step.answer !== undefined;

export async function applyAnswers(
    steps: readonly Step[],
    answers: readonly Answer[],
    ctx: AnswerContext,
    startedAt: Date,
): Promise<AnswersReport> {
    const handlers = new Map(steps.filter(answering).map((step) => [step.id, step]));
    const records = new Map<string, AnswerRecord>();
    // Each step gets all its answers in one call, so it can order its writes itself.
    for (const [stepId, routed] of route(answers)) {
        const handler = handlers.get(stepId);
        const made =
            handler === undefined
                ? routed.map((answer) => rejected(answer, stepId))
                : await handler.answer(routed, ctx);
        for (const record of made) {
            records.set(record.id, record);
        }
    }
    const ordered = answers.map((answer) => recordFor(records, answer));
    return {
        schema: "autonomous.answers.v1",
        startedAt: startedAt.toISOString(),
        outcome: ordered.every(settled) ? "advance" : "not-evaluable",
        answers: ordered,
    };
}

// With --json a configuration that fails to load still yields one document.
export function unconfiguredAnswers(path: string, error: string, startedAt: Date): AnswersReport {
    return {
        schema: "autonomous.answers.v1",
        startedAt: startedAt.toISOString(),
        outcome: "not-evaluable",
        answers: [],
        config: { path, error },
    };
}

// The step an answer is for is the text of its id before the first `:`;
// answers keep their input order within each step.
function route(answers: readonly Answer[]): Map<string, Answer[]> {
    const routes = new Map<string, Answer[]>();
    for (const answer of answers) {
        const colon = answer.id.indexOf(":");
        const stepId = colon === -1 ? answer.id : answer.id.slice(0, colon);
        routes.set(stepId, [...(routes.get(stepId) ?? []), answer]);
    }
    return routes;
}

function rejected(answer: Answer, stepId: string): AnswerRecord {
    return {
        id: answer.id,
        labels: [...answer.values],
        status: "rejected",
        detail: `no step ${stepId} takes answers`,
    };
}

// A step owes one record per answer; one left without is a fault of the runner.
function recordFor(records: Map<string, AnswerRecord>, answer: Answer): AnswerRecord {
    const record = records.get(answer.id);
    if (record === undefined) {
        throw new Error(`no record for answer ${answer.id}`);
    }
    return record;
}

const settled = (record: AnswerRecord) =>
    record.status === "applied" || record.status === "skipped";

export function renderAnswersJson(report: AnswersReport): string {
    return JSON.stringify(report, null, 2);
}

export function renderAnswersText(report: AnswersReport): string {
    const header = `autonomous answers — started ${report.startedAt}\noutcome: ${report.outcome}`;
    return [header, ...report.answers.map(renderAnswer)].join("\n");
}

function renderAnswer(record: AnswerRecord): string {
    const labels = record.labels.join(", ");
    return `  ${record.status.padEnd(9)} ${record.id} → ${labels} → ${record.detail}`;
}
