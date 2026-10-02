// The step's questions for the human (spec label-triage, "Questions for the
// human"; handoff design D4): one per asked group, except on a source whose
// writes stopped, composed entirely here so the command only relays them.

import { GROUPS, MEANINGS } from "../label-contract/contract.ts";
import type { Detection } from "../label-contract/detect.ts";
import type { HandoffOption, HandoffQuestion } from "../runner.ts";
import { compareForJudgement } from "./decide.ts";
import { LABEL_TRIAGE, questionId } from "./question-id.ts";
import { taskKey, type TriageRecord, type WriteFailure } from "./write.ts";

const MAX_HEADER = 12;

const MAX_EXCERPT = 300;

const LATER: HandoffOption = {
    label: "Later",
    value: null,
    description: "Leave it for a later run",
};

interface Asked {
    record: TriageRecord;
    detection: Detection;
}

export function questionsFor(
    records: readonly TriageRecord[],
    failures: readonly WriteFailure[],
    detections: readonly Detection[],
    descriptions: ReadonlyMap<string, string>,
): HandoffQuestion[] {
    const stopped = new Set(failures.map((failure) => failure.source));
    const byTask = new Map(
        detections.map((detection) => [
            taskKey(detection.task.source, detection.task.id),
            detection,
        ]),
    );
    const asked: Asked[] = [];
    for (const record of records) {
        const detection = byTask.get(taskKey(record.source, record.taskId));
        if (record.status === "asked" && !stopped.has(record.source) && detection !== undefined) {
            asked.push({ record, detection });
        }
    }
    const groupRank = (item: Asked) => (item.record.group === "scope" ? 0 : 1);
    asked.sort(
        (a, b) => compareForJudgement(a.detection, b.detection) || groupRank(a) - groupRank(b),
    );
    return asked.map((item) => question(item, descriptions));
}

function question(
    { record, detection }: Asked,
    descriptions: ReadonlyMap<string, string>,
): HandoffQuestion {
    const { task } = detection;
    const confidence = record.confidence.toFixed(2);
    const seen = record.labels.length > 0 ? record.labels.join(", ") : "no label";
    const lines = [
        `${record.source} ${record.taskId} "${record.title}": which ${record.group} label?`,
        `Seen: labels [${task.labels.join(", ")}] → ${seen} (${record.tier}, ${confidence}) → ${record.detail ?? ""} — ${record.reason}`,
    ];
    const description = excerpt(
        task.description ?? descriptions.get(taskKey(task.source, task.id)) ?? "",
    );
    if (description !== "") {
        lines.push(`Description: ${description}`);
    }
    const options = GROUPS[record.group].map((label): HandoffOption => {
        // Only a judgement chooses an option; a rule record's evidence is already in the text.
        const judged = record.tier === "llm" && record.labels.includes(label);
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

// Cut by code points, so a character outside the BMP (an emoji) is never split in two.
function excerpt(description: string): string {
    const characters = [...description.replace(/\s+/g, " ").trim()];
    const cut = characters.length > MAX_EXCERPT;
    return characters.slice(0, MAX_EXCERPT).join("") + (cut ? "…" : "");
}
