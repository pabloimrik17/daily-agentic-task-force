// The step's questions for the human (spec label-triage, "Questions for the
// human"): one per asked group, except on a source whose writes stopped, composed
// entirely here so the command only relays them. The options come from the same
// function that validates a decision.

import { type TaskKey, taskKey } from "../attempts/record.ts";
import {
    DECIDED_GROUPS,
    type DecidedGroup,
    isContractLabel,
    MEANINGS,
    optionsFor,
} from "../label-contract/contract.ts";
import type { Detection } from "../label-contract/detect.ts";
import type { HandoffOption, HandoffQuestion } from "../runner.ts";
import { compareForJudgement } from "./decide.ts";
import { LABEL_TRIAGE, questionId } from "./question-id.ts";
import type { TriageRecord, WriteFailure } from "./write.ts";

const MAX_HEADER = 12;

const MAX_EXCERPT = 300;

const LATER: HandoffOption = {
    label: "Later",
    value: null,
    description: "Leave it for a later run",
};

type AskedRecord = TriageRecord & { group: DecidedGroup };

interface Asked {
    record: AskedRecord;
    detection: Detection;
    written: string[]; // labels this run has already added to the task
}

export function questionsFor(
    records: readonly TriageRecord[],
    failures: readonly WriteFailure[],
    detections: readonly Detection[],
    descriptions: ReadonlyMap<TaskKey, string>,
): HandoffQuestion[] {
    const stopped = new Set(failures.map((failure) => failure.source));
    const byTask = new Map(
        detections.map((detection) => [
            taskKey(detection.task.source, detection.task.id),
            detection,
        ]),
    );
    const written = new Map<TaskKey, string[]>();
    for (const record of records) {
        if (record.status === "applied") {
            const key = taskKey(record.source, record.taskId);
            written.set(key, [...(written.get(key) ?? []), ...record.labels]);
        }
    }
    const asked: Asked[] = [];
    for (const record of records) {
        const key = taskKey(record.source, record.taskId);
        const detection = byTask.get(key);
        if (isAsked(record) && !stopped.has(record.source) && detection !== undefined) {
            asked.push({ record, detection, written: written.get(key) ?? [] });
        }
    }
    const groupRank = (item: Asked) => (item.record.group === "scope" ? 0 : 1);
    asked.sort(
        (a, b) => compareForJudgement(a.detection, b.detection) || groupRank(a) - groupRank(b),
    );
    return asked.map((item) => question(item, descriptions));
}

function isAsked(record: TriageRecord): record is AskedRecord {
    return (
        record.status === "asked" && (DECIDED_GROUPS as readonly string[]).includes(record.group)
    );
}

function question(
    { record, detection, written }: Asked,
    descriptions: ReadonlyMap<TaskKey, string>,
): HandoffQuestion {
    const { task } = detection;
    const confidence = judgedConfidence(record);
    const lines = [
        `${record.source} ${record.taskId} "${record.title}": which ${record.group} label?`,
        seenLine(record, task.labels, written, confidence),
    ];
    const description = excerpt(
        task.description ?? descriptions.get(taskKey(task.source, task.id)) ?? "",
    );
    if (description !== "") {
        lines.push(`Description: ${description}`);
    }
    // `grill-me` is an autonomy option only while the task has no stage label.
    const options = optionsFor(record.group, task.labels)
        .filter(isContractLabel)
        .map((label): HandoffOption => {
            // Only a judgement chooses an option; a rule record's evidence is already in the text.
            const judged = confidence !== null && record.labels.includes(label);
            const prefix = judged ? `judged ${confidence} · ${record.reason} — ` : "";
            return { label, value: label, description: `${prefix}${MEANINGS[label]}` };
        });
    return {
        id: questionId({ source: record.source, taskId: record.taskId, group: record.group }),
        step: LABEL_TRIAGE,
        header: record.taskId.length <= MAX_HEADER ? record.taskId : record.group,
        question: lines.join("\n"),
        options: [...options, LATER],
        multiSelect: false,
    };
}

// A rule computes no confidence and a marked group is not judged, so only a judgement has one.
function judgedConfidence(record: TriageRecord): string | null {
    return record.tier === "llm" ? (record.confidence ?? 0).toFixed(2) : null;
}

function seenLine(
    record: TriageRecord,
    taskLabels: readonly string[],
    written: readonly string[],
    confidence: string | null,
): string {
    const seen = record.labels.length > 0 ? record.labels.join(", ") : "no label";
    const added = written.length > 0 ? ` + written [${written.join(", ")}]` : "";
    const tier = confidence === null ? record.tier : `llm, ${confidence}`;
    // A marked group was not judged, so it has no detail to show.
    const detail = record.detail === null ? "" : ` → ${record.detail}`;
    return `Seen: labels [${taskLabels.join(", ")}]${added} → ${seen} (${tier})${detail} — ${record.reason}`;
}

// Cut by code points, so a character outside the BMP (an emoji) is never split in two.
function excerpt(description: string): string {
    const characters = [...description.replace(/\s+/g, " ").trim()];
    const cut = characters.length > MAX_EXCERPT;
    return characters.slice(0, MAX_EXCERPT).join("") + (cut ? "…" : "");
}
