// The id of a triage question (handoff design D4): `label-triage:<source>:<taskId>:<group>`.
// Task ids contain no `:` (Beads `agentic-task-8v0`, Linear `DOT-104`, GitHub
// `owner/name#12`), so the source and the group are split off at the first and
// the last `:`, and the rest is the task id.

import type { Source } from "../config.ts";
import { GROUPS, type Group } from "../label-contract/contract.ts";

export const LABEL_TRIAGE = "label-triage";

const SOURCES: readonly Source[] = ["beads", "github", "linear"];

export interface QuestionTarget {
    source: Source;
    taskId: string;
    group: Group;
}

export function questionId(target: QuestionTarget): string {
    return `${LABEL_TRIAGE}:${target.source}:${target.taskId}:${target.group}`;
}

export function parseQuestionId(
    id: string,
): { ok: true; target: QuestionTarget } | { ok: false; error: string } {
    const prefix = `${LABEL_TRIAGE}:`;
    const rest = id.startsWith(prefix) ? id.slice(prefix.length) : "";
    const first = rest.indexOf(":");
    const last = rest.lastIndexOf(":");
    if (first === -1 || last === first || last === first + 1) {
        return { ok: false, error: `unknown question ${id}` };
    }
    const source = rest.slice(0, first);
    const group = rest.slice(last + 1);
    if (!(SOURCES as readonly string[]).includes(source)) {
        return { ok: false, error: `unknown source ${source}` };
    }
    if (!Object.hasOwn(GROUPS, group)) {
        return { ok: false, error: `unknown group ${group}` };
    }
    return {
        ok: true,
        target: {
            source: source as Source,
            taskId: rest.slice(first + 1, last),
            group: group as Group,
        },
    };
}
