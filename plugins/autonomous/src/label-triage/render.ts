import type { StepResult } from "../runner.ts";
import type { LabelTriageData, SourceCounts } from "./step.ts";
import type { TriageRecord, WriteFailure } from "./write.ts";

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

function renderCounts(s: SourceCounts): string {
    return (
        `  ${s.source.padEnd(9)} read ${String(s.read).padEnd(3)}  complete ${s.complete}` +
        `  missing scope ${s.missing.scope} / entry ${s.missing.entry}` +
        `  conflict scope ${s.conflict.scope} / entry ${s.conflict.entry}`
    );
}

function renderDerived(record: TriageRecord): string {
    const line = `${record.source} → ${record.taskId} → ${labels(record.labels)} → ${record.reason} ${tierOf(record)}`;
    return record.detail === null ? line : `${line} — ${record.detail}`;
}

function renderAsked(record: TriageRecord): string {
    return `${record.source} → ${record.taskId} → ${record.group}: ${labels(record.labels)} ${tierOf(record)} → ${record.detail ?? ""} — ${record.reason}`;
}

function renderFailure(f: WriteFailure): string {
    const head = `${f.source} → ${f.taskId} → ${labels(f.labels)} → before [${f.before.join(", ")}]`;
    return f.after === null ? `${head} → ${f.error}` : `${head} → after [${f.after.join(", ")}]`;
}

function tierOf(record: TriageRecord): string {
    return `(${record.tier}, ${record.confidence.toFixed(2)})`;
}

function labels(names: string[]): string {
    return names.length > 0 ? names.join(", ") : "no label";
}

export function plural(count: number, one: string, many = `${one}s`): string {
    return `${count} ${count === 1 ? one : many}`;
}
