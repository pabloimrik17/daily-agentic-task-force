import type { ConfigLoad, Source, SourceRules } from "../config.ts";
import { GROUPS, type Group } from "../label-contract/contract.ts";
import { detect } from "../label-contract/detect.ts";
import { decide } from "../label-triage/decide.ts";
import { deriveByRule, type Derivation } from "../label-triage/rules.ts";
import type { TrackerTask } from "../label-triage/trackers/tracker.ts";

export interface CheckInput {
    source: Source;
    repo?: string;
    labels: string[];
}

export interface JudgedGroup {
    group: Group;
    labels: string[];
    confidence: number;
}

const GROUP_ORDER: Group[] = ["scope", "entry"];

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
    const configured =
        load.ok &&
        input.source === "github" &&
        !load.config.sources.github.repos.includes(input.repo ?? "")
            ? false
            : true;
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

export function prepare(input: CheckInput, load: ConfigLoad): string[] {
    const { detection, derivation, notes } = inspection(input, load);
    const lines = GROUP_ORDER.map((group) => {
        const state = detection.groups[group];
        if (state.status === "present") {
            return `${group}: present ${state.labels.join(", ")}`;
        }
        if (state.status === "conflict") {
            return `${group}: conflict ${state.labels.join(", ")}`;
        }
        const derived = derivation.derived.find((item) => item.group === group);
        if (derived) {
            return `${group}: derived ${derived.labels.join(", ")} (${derived.reason})`;
        }
        const conflicting = derivation.asked.find((item) => item.group === group);
        if (conflicting) {
            return `${group}: conflict ${conflicting.labels.join(", ")} (${conflicting.reason})`;
        }
        return `${group}: judge (${GROUPS[group].join(", ")})`;
    });
    return [...lines, ...notes];
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

type Inspection = ReturnType<typeof inspection>;

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
    answer: JudgedGroup | undefined,
): Resolution {
    if (!load.ok) {
        return { reason: `configuration unavailable at ${load.path}: ${load.error}` };
    }
    if (!answer) {
        return { reason: "no judgement given" };
    }
    const decision = decide(judgedDerivation(input, answer), load.config.judgement.threshold);
    return decision.status === "eligible" ? { labels: answer.labels } : { reason: decision.reason };
}

function resolveGroup(
    group: Group,
    input: CheckInput,
    load: ConfigLoad,
    { detection, derivation }: Inspection,
    answer: JudgedGroup | undefined,
): Resolution {
    const state = detection.groups[group];
    if (state.status === "present") {
        return { labels: state.labels };
    }
    if (state.status === "conflict") {
        return { reason: `conflicting present labels: ${state.labels.join(", ")}` };
    }
    const conflicting = derivation.asked.find((item) => item.group === group);
    if (conflicting) {
        return { reason: conflicting.reason };
    }
    const evidence = derivation.derived.find((item) => item.group === group);
    return evidence ? resolveEvidence(evidence, answer) : resolveJudgement(input, load, answer);
}

export function check(input: CheckInput, load: ConfigLoad, judged: JudgedGroup[]): string[] {
    const inspected = inspection(input, load);
    const apply: string[] = [];
    const ask: string[] = [];
    for (const group of GROUP_ORDER) {
        const answer = judged.find((item) => item.group === group);
        const resolution = resolveGroup(group, input, load, inspected, answer);
        if ("reason" in resolution) {
            ask.push(`ask ${group}: ${resolution.reason}; options ${GROUPS[group].join(", ")}`);
            continue;
        }
        for (const label of resolution.labels) {
            if (!apply.includes(label)) {
                apply.push(label);
            }
        }
    }
    return [`apply: ${apply.length === 0 ? "none" : apply.join(", ")}`, ...ask, ...inspected.notes];
}

function sameLabels(left: string[], right: string[]): boolean {
    return left.length === right.length && left.every((label) => right.includes(label));
}
