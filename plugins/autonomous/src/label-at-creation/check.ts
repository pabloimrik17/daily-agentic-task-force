import type { ConfigLoad, Source, SourceRules } from "../config.ts";
import {
    DECIDED_GROUPS,
    type DecidedGroup,
    GROUPS,
    type Group,
    optionsFor,
} from "../label-contract/contract.ts";
import { detect } from "../label-contract/detect.ts";
import { decide } from "../label-triage/decide.ts";
import { deriveByRule, recordsForAutonomy, type Derivation } from "../label-triage/rules.ts";
import type { TrackerTask } from "../label-triage/trackers/tracker.ts";

export interface CheckInput {
    source: Source;
    repo?: string;
    labels: string[];
}

export interface JudgedGroup {
    group: DecidedGroup;
    labels: string[];
    confidence: number;
}

// The helper reports every group, but only scope and autonomy are decided: the stage
// follows the autonomy and is never judged. A stage in conflict is the one case where it
// is asked about.
const REPORTED_GROUPS: readonly Group[] = [...DECIDED_GROUPS, "stage"];

function inspection(input: CheckInput, load: ConfigLoad) {
    const task: TrackerTask = {
        source: input.source,
        id: "new",
        title: "",
        description: null,
        labels: [...new Set(input.labels)],
        status: "",
        updatedAt: "",
    };
    const repo = input.repo?.toLowerCase() ?? "";
    const configured =
        !load.ok ||
        input.source !== "github" ||
        load.config.sources.github.repos.some((name) => name.toLowerCase() === repo);
    const rules: SourceRules = load.ok
        ? {
              ...load.config.sources[input.source],
              ...(configured ? {} : { scope: undefined }),
          }
        : { enabled: false };
    const detection = detect(task, rules);
    const derivation = deriveByRule(detection);
    const notes: string[] = [];
    if (!load.ok) {
        notes.push(`configuration ${load.path}: ${load.error}`);
    }
    if (!configured) {
        notes.push(
            `repository ${input.repo} is not configured; contract labels may not exist there`,
        );
    }
    return { detection, derivation, notes };
}

type Inspection = ReturnType<typeof inspection>;

export function prepare(input: CheckInput, load: ConfigLoad): string[] {
    const inspected = inspection(input, load);
    const lines = REPORTED_GROUPS.map((group) => `${group}: ${describe(group, inspected)}`);
    return [...lines, ...inspected.notes];
}

function describe(group: Group, inspected: Inspection): string {
    const state = inspected.detection.groups[group];
    switch (state.status) {
        case "present":
            return `present ${state.labels.join(", ")}`;
        case "conflict":
            return `conflict ${state.labels.join(", ")}`;
        case "deferred":
            return "not needed (grill-me)";
        case "missing":
            return describeMissing(group, inspected);
    }
}

function describeMissing(group: Group, inspected: Inspection): string {
    if (group === "stage") {
        return describeStage(inspected);
    }
    const { detection, derivation } = inspected;
    const derived = derivation.derived.find((item) => item.group === group);
    if (derived) {
        return `derived ${derived.labels.join(", ")} (${derived.reason})`;
    }
    const conflicting = derivation.asked.find((item) => item.group === group);
    if (conflicting) {
        return `conflict ${conflicting.labels.join(", ")} (${conflicting.reason})`;
    }
    return `judge (${optionsFor(group, detection.task.labels).join(", ")})`;
}

function describeStage({ detection, derivation }: Inspection): string {
    const autonomy = detection.groups.autonomy;
    if (autonomy.status === "present") {
        return `derived proposal (autonomy ${autonomy.labels.join(", ")})`;
    }
    const decided = derivation.derived.find((item) => item.group === "autonomy");
    if (decided === undefined) {
        return "follows autonomy";
    }
    return decided.labels.includes("grill-me")
        ? `derived grill-me (${decided.reason})`
        : `derived proposal (autonomy ${decided.labels.join(", ")})`;
}

function judgedDerivation(input: CheckInput, judged: JudgedGroup): Derivation {
    return {
        source: input.source,
        taskId: "new",
        title: "",
        group: judged.group,
        labels: judged.labels,
        confidence: judged.confidence,
        reason: "creating agent judgement",
        tier: "llm",
    };
}

type Resolution = { labels: string[] } | { reason: string };

function resolveEvidence(evidence: Derivation, answer: JudgedGroup | undefined): Resolution {
    if (answer && !sameLabels(evidence.labels, answer.labels)) {
        return {
            reason: `evidence ${evidence.labels.join(", ")} (${evidence.reason}) disagrees with judgement ${answer.labels.join(", ") || "none"}`,
        };
    }
    return { labels: evidence.labels };
}

function resolveJudgement(
    input: CheckInput,
    load: ConfigLoad,
    taskLabels: readonly string[],
    answer: JudgedGroup | undefined,
): Resolution {
    if (!load.ok) {
        return { reason: "configuration unavailable" };
    }
    if (!answer) {
        return { reason: "no judgement given" };
    }
    const decision = decide(
        judgedDerivation(input, answer),
        load.config.judgement.threshold,
        taskLabels,
    );
    return decision.status === "eligible" ? { labels: answer.labels } : { reason: decision.reason };
}

function resolveGroup(
    group: DecidedGroup,
    input: CheckInput,
    load: ConfigLoad,
    { detection, derivation }: Inspection,
    answer: JudgedGroup | undefined,
): Resolution {
    const state = detection.groups[group];
    if (state.status === "present") {
        return { labels: state.labels };
    }
    if (state.status === "deferred") {
        return { labels: [] };
    }
    if (state.status === "conflict") {
        return { reason: `conflicting present labels: ${state.labels.join(", ")}` };
    }
    const conflicting = derivation.asked.find((item) => item.group === group);
    if (conflicting) {
        return { reason: conflicting.reason };
    }
    const evidence = derivation.derived.find((item) => item.group === group);
    return evidence
        ? resolveEvidence(evidence, answer)
        : resolveJudgement(input, load, detection.task.labels, answer);
}

// An applied autonomy brings the stage it implies, unless the task will already carry a
// stage label: `proposal` with `AFK` or `HITL`, `grill-me` alone.
function withStage(input: CheckInput, resolution: Resolution, taskLabels: string[]): Resolution {
    if ("reason" in resolution) {
        return resolution;
    }
    const decision = judgedDerivation(input, {
        group: "autonomy",
        labels: resolution.labels,
        confidence: 1,
    });
    return {
        labels: recordsForAutonomy(decision, taskLabels).flatMap((record) => record.labels),
    };
}

function resolveDecided(
    group: DecidedGroup,
    input: CheckInput,
    load: ConfigLoad,
    inspected: Inspection,
    answer: JudgedGroup | undefined,
): Resolution {
    const resolution = resolveGroup(group, input, load, inspected, answer);
    return group === "autonomy"
        ? withStage(input, resolution, inspected.detection.task.labels)
        : resolution;
}

export function check(input: CheckInput, load: ConfigLoad, judged: JudgedGroup[]): string[] {
    const inspected = inspection(input, load);
    const taskLabels = inspected.detection.task.labels;
    const apply: string[] = [];
    const ask: string[] = [];
    for (const group of DECIDED_GROUPS) {
        const answer = judged.find((item) => item.group === group);
        const resolution = resolveDecided(group, input, load, inspected, answer);
        if ("reason" in resolution) {
            ask.push(askLine(group, resolution.reason, optionsFor(group, taskLabels)));
            continue;
        }
        addLabels(apply, resolution.labels);
    }
    const stage = inspected.detection.groups.stage;
    if (stage.status === "present") {
        addLabels(apply, stage.labels);
    }
    if (stage.status === "conflict") {
        ask.push(
            askLine(
                "stage",
                `conflicting present labels: ${stage.labels.join(", ")}`,
                GROUPS.stage,
            ),
        );
    }
    return [`apply: ${apply.length === 0 ? "none" : apply.join(", ")}`, ...ask, ...inspected.notes];
}

function askLine(group: Group, reason: string, options: readonly string[]): string {
    return `ask ${group}: ${reason}; options ${options.join(", ")}`;
}

function addLabels(apply: string[], labels: readonly string[]): void {
    for (const label of labels) {
        if (!apply.includes(label)) {
            apply.push(label);
        }
    }
}

function sameLabels(left: string[], right: string[]): boolean {
    return left.length === right.length && left.every((label) => right.includes(label));
}
