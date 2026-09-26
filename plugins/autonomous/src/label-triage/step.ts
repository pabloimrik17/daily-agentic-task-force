// The label-triage step (spec label-triage; design D7, D8): reads every
// enabled source, detects the contract groups, derives what is missing by rule
// and then by judgement, and writes only with --apply. Reading fails closed —
// a source that cannot be read makes the step not evaluable, with no partial
// evaluation — while judging degrades: a failed judgement leaves its tasks not
// judged and the outcome unaffected. The step never returns `wait`.

import type { AutonomousConfig, Source } from "../config.ts";
import { GROUPS, type Group } from "../label-contract/contract.ts";
import { type Detection, detect } from "../label-contract/detect.ts";
import type { Step, StepResult, StepTier } from "../runner.ts";
import { decide, selectForJudgement } from "./decide.ts";
import {
    interpretAnswers,
    type JudgementExec,
    type JudgementRequest,
    type JudgementTask,
} from "./judgement.ts";
import { plural, renderLabelTriage } from "./render.ts";
import { type Derivation, deriveByRule } from "./rules.ts";
import type { Trackers } from "./trackers/tracker.ts";
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
    return { step: "label-triage", tier, outcome, reasons, data };
}

export const labelTriageStep: Step<LabelTriageData> = {
    id: "label-triage",
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

        // A missing group with evidence is settled by rule (derived, or asked on
        // conflicting evidence); only a missing group without any goes to judgement.
        const candidates = new Map<Detection, Group[]>();
        for (const detection of detections) {
            const groups = ALL_GROUPS.filter((group) => {
                const state = detection.groups[group];
                return state.status === "missing" && state.evidence.length === 0;
            });
            if (groups.length > 0) {
                candidates.set(detection, groups);
            }
        }

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
        const eligible: Derivation[] = [];
        const asked: TriageRecord[] = [];
        for (const derivation of derivations) {
            const decision = decide(derivation, config.judgement.threshold);
            if (decision.status === "eligible") {
                eligible.push(derivation);
            } else {
                asked.push({ ...derivation, status: "asked", detail: decision.reason });
            }
        }

        const tasks = new Map(
            detections.map((detection) => [
                taskKey(detection.task.source, detection.task.id),
                detection.task,
            ]),
        );
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
        // The step's tier is the highest its parts used in this run: `llm` once a
        // judgement batch was requested, `code` otherwise.
        return result("advance", reasonsFor(data), data, judged.batches > 0 ? "llm" : "code");
    },
    render: renderLabelTriage,
};

function countSource(source: Source, detections: Detection[]): SourceCounts {
    const own = detections.filter((detection) => detection.task.source === source);
    const count = (group: Group, status: "missing" | "conflict") =>
        own.filter((detection) => detection.groups[group].status === status).length;
    return {
        source,
        read: own.length,
        complete: own.filter((detection) =>
            ALL_GROUPS.every((group) => detection.groups[group].status === "present"),
        ).length,
        missing: { scope: count("scope", "missing"), entry: count("entry", "missing") },
        conflict: { scope: count("scope", "conflict"), entry: count("entry", "conflict") },
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
    candidates: Map<Detection, Group[]>,
    trackers: Trackers,
    judgement: JudgementExec,
    config: AutonomousConfig,
): Promise<{
    derivations: Derivation[];
    notJudged: LabelTriageData["notJudged"];
    batches: number;
}> {
    const notJudged: LabelTriageData["notJudged"] = [];
    const ready: JudgementTask[] = [];
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
    return { derivations, notJudged, batches };
}

function labelCount(records: TriageRecord[]): number {
    return records.reduce((total, record) => total + record.labels.length, 0);
}

function reasonsFor(data: LabelTriageData): string[] {
    const reasons = data.sources.map(
        (s) =>
            `${s.source}: ${s.read} read, ${s.complete} complete, ${s.missing.scope} missing scope, ` +
            `${s.missing.entry} missing entry, ${s.conflict.scope + s.conflict.entry} in conflict`,
    );
    for (const status of ["applied", "proposed"] as const) {
        const labels = labelCount(data.records.filter((record) => record.status === status));
        if (labels > 0) {
            reasons.push(`${status} ${plural(labels, "label")}`);
        }
    }
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
