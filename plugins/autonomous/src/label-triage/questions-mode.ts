// Triage questions mode (spec autonomous-run, "Triage questions mode" and "Triage questions
// report"): the questions of the marked tasks, composed as the label-triage step does, with no
// judgement, no write and no lock, so the loop command can ask them all before it starts.

import type { AutonomousConfig } from "../config.ts";
import type { Detection } from "../label-contract/detect.ts";
import { buildHandoff, type Handoff, renderHandoffLine } from "../report.ts";
import type { HandoffQuestion } from "../runner.ts";
import { decide, markedRecords } from "./decide.ts";
import { questionsFor } from "./questions.ts";
import { plural } from "./render.ts";
import { type Derivation, deriveByRule } from "./rules.ts";
import { readDetections } from "./step.ts";
import type { Trackers } from "./trackers/tracker.ts";
import type { TriageRecord } from "./write.ts";

export const TRIAGE_QUESTIONS_SCHEMA = "autonomous.triage-questions.v1";

export interface TriageQuestionsReport {
    schema: typeof TRIAGE_QUESTIONS_SCHEMA;
    startedAt: string;
    outcome: "advance" | "not-evaluable";
    marked: number; // marked tasks read
    questions: HandoffQuestion[]; // every question, in the order of questionsFor
    handoff?: Handoff; // absent when there is no question
    reasons: string[]; // the read or configuration error when not evaluable
}

export interface TriageQuestionsDeps {
    config: AutonomousConfig;
    trackers: Trackers;
}

export async function runTriageQuestions(
    deps: TriageQuestionsDeps,
    startedAt: Date,
): Promise<TriageQuestionsReport> {
    const read = await readDetections(deps.config, deps.trackers);
    if (!read.ok) {
        return notEvaluable(read.error, startedAt);
    }
    const marked = read.value.filter((detection) => detection.marked);
    const questions = questionsFor(
        askedRecords(marked, deps.config.judgement.threshold),
        [],
        marked,
        new Map(),
    );
    return {
        schema: TRIAGE_QUESTIONS_SCHEMA,
        startedAt: startedAt.toISOString(),
        outcome: "advance",
        marked: marked.length,
        questions,
        ...(questions.length > 0 ? { handoff: buildHandoff(questions) } : {}),
        reasons: [],
    };
}

// A configuration that fails to load still yields one document with --json; the error itself
// also goes to stderr. Most load errors already name the path.
export function unconfiguredTriageQuestions(
    path: string,
    error: string,
    startedAt: Date,
): TriageQuestionsReport {
    return notEvaluable(error.includes(path) ? error : `${path}: ${error}`, startedAt);
}

function notEvaluable(reason: string, startedAt: Date): TriageQuestionsReport {
    return {
        schema: TRIAGE_QUESTIONS_SCHEMA,
        startedAt: startedAt.toISOString(),
        outcome: "not-evaluable",
        marked: 0,
        questions: [],
        reasons: [reason],
    };
}

// What the step leaves asked for a marked task: the groups a rule cannot settle, as `decideAll`
// records them, then the groups nothing decides (`markedRecords`).
function askedRecords(marked: readonly Detection[], threshold: number): TriageRecord[] {
    const fromRules = marked.flatMap((detection) =>
        deriveByRule(detection).asked.flatMap((derivation) =>
            askedRecord(derivation, detection.task.labels, threshold),
        ),
    );
    return [...fromRules, ...markedRecords(marked)];
}

function askedRecord(
    derivation: Derivation,
    labels: readonly string[],
    threshold: number,
): TriageRecord[] {
    const decision = decide(derivation, threshold, labels);
    return decision.status === "asked"
        ? [{ ...derivation, status: "asked", detail: decision.reason }]
        : [];
}

export function renderTriageQuestionsJson(report: TriageQuestionsReport): string {
    return JSON.stringify(report, null, 2);
}

// The handoff line, when present, is the last line.
export function renderTriageQuestionsText(report: TriageQuestionsReport): string {
    const marked =
        report.outcome === "advance"
            ? [report.marked === 0 ? "no marked task" : `marked: ${plural(report.marked, "task")}`]
            : [];
    return [
        `triage questions — started ${report.startedAt}`,
        `outcome: ${report.outcome}`,
        ...marked,
        ...report.reasons.map((reason) => `reason: ${reason}`),
        ...report.questions.map(renderQuestion),
        ...(report.handoff === undefined ? [] : [renderHandoffLine(report.handoff)]),
    ].join("\n");
}

function renderQuestion(question: HandoffQuestion): string {
    const options = question.options.map((option) => option.label).join(" | ");
    return [`question ${question.id}`, ...question.question.split("\n"), `options: ${options}`]
        .map((line, index) => (index === 0 ? line : `  ${line}`))
        .join("\n");
}
