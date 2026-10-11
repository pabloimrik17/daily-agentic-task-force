import { plural } from "../label-triage/render.ts";
import type { StepResult } from "../runner.ts";
import type { Excluded, Exclusion, SelectData, SelectedUnit } from "./types.ts";

// The exclusions in the order they are checked (design D3), as the report names them.
const EXCLUSION_NAMES: Record<Exclusion, string> = {
    classification: "classification",
    taken: "taken",
    "labelled-this-run": "labelled this run",
    "unsupported-stage": "unsupported stage",
    blocked: "blocked",
    split: "split",
};

const EXCLUSIONS = Object.keys(EXCLUSION_NAMES) as Exclusion[];

// The excluded tasks grouped by reason, in D3's order, leaving out empty groups.
export function byReason(excluded: readonly Excluded[]): { name: string; tasks: Excluded[] }[] {
    return EXCLUSIONS.map((reason) => ({
        name: EXCLUSION_NAMES[reason],
        tasks: excluded.filter((task) => task.reason === reason),
    })).filter((group) => group.tasks.length > 0);
}

export function renderSelect(result: StepResult<SelectData>): string {
    const { machineScope, selected, candidates, excluded, notEvaluated, comparison } = result.data;
    const lines = [`[${result.step}] ${result.outcome} (${result.tier})`];

    if (machineScope !== null) {
        lines.push(`  machine scope  ${machineScope}`);
    }
    if (selected !== null) {
        lines.push(...renderSelected(selected));
    }
    if (candidates.length > 0) {
        lines.push(
            `  candidates: ${plural(candidates.length, "task")}`,
            ...candidates.map(
                (c) => `    ${c.source} → ${c.id} → ${c.title} (${c.scope}, ${c.stage})`,
            ),
        );
    }
    if (excluded.length > 0) {
        lines.push(`  excluded: ${plural(excluded.length, "task")}`);
        for (const group of byReason(excluded)) {
            lines.push(
                `    ${group.name}: ${group.tasks.length}`,
                ...group.tasks.map((t) => `      ${t.source} → ${t.id} → ${t.title}`),
            );
        }
    }
    lines.push(...notEvaluated.map((part) => `  not evaluated: ${part}`));
    if (comparison !== null) {
        lines.push(`  comparison: ${comparison.model} (${comparison.effort})`);
    }
    lines.push("  reasons:", ...result.reasons.map((r) => `    - ${r}`));
    return lines.join("\n");
}

function renderSelected(selected: SelectedUnit): string[] {
    const lines = [
        `  selected  ${selected.source} → ${selected.id} → ${selected.title}`,
        `    stage        ${selected.stage}`,
        `    autonomy     ${selected.autonomy}`,
        `    scope        ${selected.scope}`,
        `    explanation  ${selected.explanation}`,
    ];
    if (selected.exception !== null) {
        lines.push(`    exception    outside the machine scope: ${selected.exception}`);
    }
    return lines;
}
