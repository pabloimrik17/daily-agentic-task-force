// The label-triage step (spec label-triage): reads every enabled source,
// detects the contract groups, derives what is missing by rule and then by
// judgement, and writes only with --apply. Reading fails closed — a source
// that cannot be read makes the step not evaluable, with no partial
// evaluation — while judging degrades: a failed judgement leaves its tasks not
// judged and the outcome unaffected. The step never returns `wait`. The groups
// it leaves for the human become its questions. The stage is never judged or
// asked: it follows the autonomy decision.

import type { AutonomousConfig, Source } from "../config.ts";
import {
    DECIDED_GROUPS,
    type DecidedGroup,
    GROUPS,
    type Group,
} from "../label-contract/contract.ts";
import { type Detection, detect, isComplete } from "../label-contract/detect.ts";
import type { Step, StepResult, StepTier } from "../runner.ts";
import { answerLabelTriage } from "./answer.ts";
import { decide, selectForJudgement } from "./decide.ts";
import {
    interpretAnswers,
    type JudgementExec,
    type JudgementRequest,
    type JudgementTask,
} from "./judgement.ts";
import { LABEL_TRIAGE } from "./question-id.ts";
import { questionsFor } from "./questions.ts";
import { plural, renderLabelTriage } from "./render.ts";
import { type Derivation, deriveByRule, recordsForAutonomy } from "./rules.ts";
import type { TrackerTask, Trackers } from "./trackers/tracker.ts";
import { applyDerivations, taskKey, type TriageRecord, type WriteFailure } from "./write.ts";

export interface SourceCounts {
    source: Source;
    read: number;
    complete: number;
    missing: Record<Group, number>;
    conflict: Record<Group, number>;
}

export interface LabelTriageData {
    sources: SourceCounts[];
    records: TriageRecord[]; // one per derived group, every status
    conflicts: { source: Source; taskId: string; title: string; group: Group; labels: string[] }[];
    notJudged: { source: Source; taskId: string; reason: string }[];
    remainder: number; // tasks beyond the cap
    judgement: { model: string; effort: string; cap: number; batches: number } | null;
    failures: WriteFailure[];
}

const SOURCE_ORDER: readonly Source[] = ["beads", "github", "linear"];

const ALL_GROUPS = Object.keys(GROUPS) as Group[];

const EMPTY: LabelTriageData = {
    sources: [],
    records: [],
    conflicts: [],
    notJudged: [],
    remainder: 0,
    judgement: null,
    failures: [],
};

function result(
    outcome: StepResult["outcome"],
    reasons: string[],
    data: LabelTriageData,
    tier: StepTier = "code",
): StepResult<LabelTriageData> {
    return { step: LABEL_TRIAGE, tier, outcome, reasons, data };
}

export const labelTriageStep: Step<LabelTriageData> = {
    id: LABEL_TRIAGE,
    async run(ctx) {
        if (!ctx.config.ok) {
            return result("not-evaluable", [ctx.config.error], EMPTY);
        }
        const { config } = ctx.config;
        const trackers = ctx.io.trackers(config);
        const enabled = SOURCE_ORDER.filter((source) => config.sources[source].enabled);

        const detections: Detection[] = [];
        for (const source of enabled) {
            const listed = await trackers[source].listTasks();
            if (!listed.ok) {
                return result("not-evaluable", [`${source}: ${listed.error}`], EMPTY);
            }
            detections.push(...listed.value.map((task) => detect(task, config.sources[source])));
        }

        const sources = enabled.map((source) => countSource(source, detections));
        const conflicts = detections.flatMap(conflictsOf);

        const candidates = judgementCandidates(detections);

        const { selected, remainder } = selectForJudgement(
            [...candidates.keys()],
            config.judgement.cap,
        );
        const judged = await judge(selected, candidates, trackers, ctx.io.judgement, config);

        const derivations = sortBySource([
            ...detections.flatMap((detection) => {
                const { derived, asked } = deriveByRule(detection);
                return [...derived, ...asked];
            }),
            ...judged.derivations,
        ]);
        const tasks = new Map(
            detections.map((detection) => [
                taskKey(detection.task.source, detection.task.id),
                detection.task,
            ]),
        );
        const { eligible, asked } = decideAll(derivations, tasks, config.judgement.threshold);
        const written = await applyDerivations(eligible, tasks, trackers, ctx.args.apply);

        const data: LabelTriageData = {
            sources,
            records: [...written.records, ...asked],
            conflicts,
            notJudged: judged.notJudged,
            remainder,
            judgement: {
                model: config.judgement.model,
                effort: config.judgement.effort,
                cap: config.judgement.cap,
                batches: judged.batches,
            },
            failures: written.failures,
        };
        const questions = questionsFor(
            data.records,
            data.failures,
            detections,
            judged.descriptions,
        );
        // The step's tier is the highest its parts used in this run: `llm` once a
        // judgement batch was requested, `code` otherwise.
        const tier = judged.batches > 0 ? "llm" : "code";
        return {
            ...result("advance", reasonsFor(data, written.missing), data, tier),
            questions,
        };
    },
    render: renderLabelTriage,
    answer: answerLabelTriage,
};

// A missing group with evidence is settled by rule (derived, or asked on conflicting
// evidence); only a missing scope or autonomy without any goes to judgement. The stage
// is never judged, and a deferred autonomy is complete.
function judgementCandidates(detections: Detection[]): Map<Detection, DecidedGroup[]> {
    const candidates = new Map<Detection, DecidedGroup[]>();
    for (const detection of detections) {
        const groups = DECIDED_GROUPS.filter((group) => {
            const state = detection.groups[group];
            return state.status === "missing" && state.evidence.length === 0;
        });
        if (groups.length > 0) {
            candidates.set(detection, groups);
        }
    }
    return candidates;
}

function decideAll(
    derivations: Derivation[],
    tasks: ReadonlyMap<string, TrackerTask>,
    threshold: number,
): { eligible: Derivation[]; asked: TriageRecord[] } {
    const eligible: Derivation[] = [];
    const asked: TriageRecord[] = [];
    for (const derivation of derivations) {
        const labels = tasks.get(taskKey(derivation.source, derivation.taskId))?.labels ?? [];
        const decision = decide(derivation, threshold, labels);
        if (decision.status === "asked") {
            asked.push({ ...derivation, status: "asked", detail: decision.reason });
        } else if (derivation.group === "autonomy") {
            eligible.push(...recordsForAutonomy(derivation, labels));
        } else {
            eligible.push(derivation);
        }
    }
    return { eligible, asked };
}

function countSource(source: Source, detections: Detection[]): SourceCounts {
    const own = detections.filter((detection) => detection.task.source === source);
    const count = (status: "missing" | "conflict"): Record<Group, number> => ({
        scope: own.filter((detection) => detection.groups.scope.status === status).length,
        autonomy: own.filter((detection) => detection.groups.autonomy.status === status).length,
        stage: own.filter((detection) => detection.groups.stage.status === status).length,
    });
    return {
        source,
        read: own.length,
        complete: own.filter((detection) =>
            ALL_GROUPS.every((group) => isComplete(detection.groups[group])),
        ).length,
        missing: count("missing"),
        conflict: count("conflict"),
    };
}

function conflictsOf(detection: Detection): LabelTriageData["conflicts"] {
    const { task } = detection;
    return ALL_GROUPS.flatMap((group) => {
        const state = detection.groups[group];
        if (state.status !== "conflict") {
            return [];
        }
        return [
            {
                source: task.source,
                taskId: task.id,
                title: task.title,
                group,
                labels: state.labels,
            },
        ];
    });
}

function sortBySource(derivations: Derivation[]): Derivation[] {
    return [...derivations].sort(
        (a, b) => SOURCE_ORDER.indexOf(a.source) - SOURCE_ORDER.indexOf(b.source),
    );
}

// Judging degrades: a description that cannot be read, or a batch that fails,
// leaves those tasks not judged and the rest of the step unaffected.
async function judge(
    selected: Detection[],
    candidates: Map<Detection, DecidedGroup[]>,
    trackers: Trackers,
    judgement: JudgementExec,
    config: AutonomousConfig,
): Promise<{
    derivations: Derivation[];
    notJudged: LabelTriageData["notJudged"];
    batches: number;
    descriptions: Map<string, string>;
}> {
    const { ready, notJudged, descriptions } = await readForJudgement(
        selected,
        candidates,
        trackers,
    );
    const derivations: Derivation[] = [];
    let batches = 0;
    for (let start = 0; start < ready.length; start += config.judgement.batch) {
        const request: JudgementRequest = {
            model: config.judgement.model,
            effort: config.judgement.effort,
            tasks: ready.slice(start, start + config.judgement.batch),
        };
        batches++;
        const answered = await judgement(request);
        if (!answered.ok) {
            notJudged.push(
                ...request.tasks.map((task) => ({
                    source: task.source,
                    taskId: task.id,
                    reason: answered.error,
                })),
            );
            continue;
        }
        const interpreted = interpretAnswers(request, answered.answers);
        derivations.push(...interpreted.judged);
        notJudged.push(
            ...interpreted.notJudged.map(({ id, source, reason }) => ({
                source,
                taskId: id,
                reason,
            })),
        );
    }
    return { derivations, notJudged, batches, descriptions };
}

// A listing without descriptions (Linear) is completed task by task. The
// descriptions read here, keyed by `taskKey`, also go into the questions.
async function readForJudgement(
    selected: Detection[],
    candidates: Map<Detection, DecidedGroup[]>,
    trackers: Trackers,
): Promise<{
    ready: JudgementTask[];
    notJudged: LabelTriageData["notJudged"];
    descriptions: Map<string, string>;
}> {
    const ready: JudgementTask[] = [];
    const notJudged: LabelTriageData["notJudged"] = [];
    const descriptions = new Map<string, string>();
    for (const detection of selected) {
        const { task } = detection;
        let description = task.description;
        if (description === null) {
            const read = await trackers[task.source].readTask(task.id);
            if (!read.ok) {
                notJudged.push({ source: task.source, taskId: task.id, reason: read.error });
                continue;
            }
            description = read.value.description;
            if (description !== null) {
                descriptions.set(taskKey(task.source, task.id), description);
            }
        }
        ready.push({
            id: task.id,
            source: task.source,
            title: task.title,
            description,
            labels: task.labels,
            groups: candidates.get(detection) ?? [],
        });
    }
    return { ready, notJudged, descriptions };
}

function labelCount(records: TriageRecord[]): number {
    return records.reduce((total, record) => total + record.labels.length, 0);
}

// `missing`: the label-availability notes, one line per label a tracker lacks (naming the
// bootstrap) and, without --apply, per source whose labels could not be listed.
function reasonsFor(data: LabelTriageData, missing: readonly string[]): string[] {
    const reasons = data.sources.map(
        (s) =>
            `${s.source}: ${s.read} read, ${s.complete} complete, ${s.missing.scope} missing scope, ` +
            `${s.missing.autonomy} missing autonomy, ${s.missing.stage} missing stage, ` +
            `${s.conflict.scope + s.conflict.autonomy + s.conflict.stage} in conflict`,
    );
    for (const status of ["applied", "proposed"] as const) {
        const labels = labelCount(data.records.filter((record) => record.status === status));
        if (labels > 0) {
            reasons.push(`${status} ${plural(labels, "label")}`);
        }
    }
    reasons.push(...missing);
    const forHuman =
        data.records.filter((record) => record.status === "asked").length + data.conflicts.length;
    if (forHuman > 0) {
        reasons.push(`${plural(forHuman, "group")} for the human`);
    }
    if (data.notJudged.length > 0 || data.remainder > 0) {
        reasons.push(
            `${plural(data.notJudged.length, "task")} not judged, ${data.remainder} beyond the cap of ${data.judgement?.cap ?? 0}`,
        );
    }
    if (data.failures.length > 0) {
        reasons.push(plural(data.failures.length, "write failure"));
    }
    return reasons;
}
