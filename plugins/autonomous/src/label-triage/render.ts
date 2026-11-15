import { GROUPS, type Group, TRIAGE_LABEL } from "../label-contract/contract.ts";
import type { StepResult } from "../runner.ts";
import type { LabelTriageData, SourceCounts } from "./step.ts";
import {
    type MarkRecord,
    READ_BACK_MISMATCH,
    type TriageRecord,
    type WriteFailure,
} from "./write.ts";

export function renderLabelTriage(result: StepResult<LabelTriageData>): string {
    const { sources, records, conflicts, notJudged, remainder, judgement, failures } = result.data;
    const lines = [`[${result.step}] ${result.outcome} (${result.tier})`];

    lines.push(...sources.map(renderCounts));
    for (const status of ["applied", "proposed"] as const) {
        const matching = records.filter((record) => record.status === status);
        if (matching.length > 0) {
            lines.push(`  ${status}:`, ...matching.map((record) => `    ${renderDerived(record)}`));
        }
    }
    lines.push(...renderMarks(result.data));

    const asked = records.filter((record) => record.status === "asked");
    if (conflicts.length > 0 || asked.length > 0) {
        lines.push(
            "  for the human:",
            ...conflicts.map(
                (c) =>
                    `    ${c.source} → ${c.taskId} → ${c.group}: ${c.labels.join(", ")} seen → conflict`,
            ),
            ...asked.map((record) => `    ${renderAsked(record)}`),
        );
    }
    if (notJudged.length > 0) {
        lines.push(
            `  not judged: ${plural(notJudged.length, "task")}`,
            ...notJudged.map((n) => `    ${n.source} → ${n.taskId} → ${n.reason}`),
        );
    }
    if (remainder > 0 && judgement !== null) {
        lines.push(`  remainder: ${plural(remainder, "task")} beyond the cap of ${judgement.cap}`);
    }
    if (failures.length > 0) {
        lines.push("  write failures:", ...failures.map((f) => `    ${renderFailure(f)}`));
    }
    if (judgement !== null) {
        lines.push(
            `  judgement: ${judgement.model} (${judgement.effort}), ${plural(judgement.batches, "batch", "batches")}`,
        );
    }
    lines.push("  reasons:", ...result.reasons.map((r) => `    - ${r}`));
    return lines.join("\n");
}

// One line per task this run marked or unmarked, then how many carried the label when read.
function renderMarks({ marked, unmarked, markedRead }: LabelTriageData): string[] {
    if (markedRead === 0 && marked.length === 0 && unmarked.length === 0) {
        return [];
    }
    return [
        "  triage-me:",
        ...marked.map((mark) => `    ${renderMark(mark, "marked")}`),
        ...unmarked.map((mark) => `    ${renderMark(mark, "unmarked")}`),
        `    read with the label: ${plural(markedRead, "task")}`,
    ];
}

function renderMark(mark: MarkRecord, done: "marked" | "unmarked"): string {
    const state = { applied: done, proposed: `proposed ${done}`, failed: "failed" }[mark.status];
    const line = `${mark.source} → ${mark.taskId} → ${TRIAGE_LABEL} → ${state}`;
    return mark.status === "applied" || mark.detail === null ? line : `${line} — ${mark.detail}`;
}

function renderCounts(s: SourceCounts): string {
    return (
        `  ${s.source.padEnd(9)} read ${String(s.read).padEnd(3)}  complete ${s.complete}` +
        `  missing ${perGroup(s.missing)}  conflict ${perGroup(s.conflict)}`
    );
}

function perGroup(counts: Record<Group, number>): string {
    return (Object.keys(GROUPS) as Group[]).map((group) => `${group} ${counts[group]}`).join(" / ");
}

function renderDerived(record: TriageRecord): string {
    const line = `${record.source} → ${record.taskId} → ${labels(record.labels)} → ${record.reason} ${tierOf(record)}`;
    return record.detail === null ? line : `${line} — ${record.detail}`;
}

function renderAsked(record: TriageRecord): string {
    const detail = record.detail === null ? "" : ` → ${record.detail}`;
    return `${record.source} → ${record.taskId} → ${record.group}: ${labels(record.labels)} ${tierOf(record)}${detail} — ${record.reason}`;
}

function renderFailure(f: WriteFailure): string {
    const head = `${f.source} → ${f.taskId} → ${labels(f.labels)} → before [${f.before.join(", ")}]`;
    if (f.after === null) {
        return `${head} → ${f.error}`;
    }
    const line = `${head} → after [${f.after.join(", ")}]`;
    // A read-back mismatch is its before and after, already on the line; any other error
    // cut a write short after some labels landed, so it carries the cause.
    return f.error.startsWith(READ_BACK_MISMATCH) ? line : `${line} → ${f.error}`;
}

function tierOf(record: TriageRecord): string {
    // A marked group was not judged, so it has no confidence.
    return record.confidence === null
        ? `(${record.tier})`
        : `(${record.tier}, ${record.confidence.toFixed(2)})`;
}

function labels(names: string[]): string {
    return names.length > 0 ? names.join(", ") : "no label";
}

export function plural(count: number, one: string, many = `${one}s`): string {
    return `${count} ${count === 1 ? one : many}`;
}
