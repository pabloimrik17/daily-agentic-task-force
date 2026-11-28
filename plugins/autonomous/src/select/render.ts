import { plural } from "../label-triage/render.ts";
import type { StepResult } from "../runner.ts";
import type { Excluded, Exclusion, SelectData, SelectedUnit } from "./types.ts";

// The exclusions in the order they are checked (design D3), as the report names them.
const EXCLUSION_NAMES: Record<Exclusion, string> = {
    classification: "classification",
    taken: "taken",
    "triage-me": "triage-me",
    "labelled-this-run": "labelled this run",
    "unsupported-stage": "unsupported stage",
    blocked: "blocked",
    split: "split",
    "no-free-slot": "no free slot",
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
    const { machineScope, selected, candidates, setAside, excluded, readyToClose, comparison } =
        result.data;
    const lines = [`[${result.step}] ${result.outcome} (${result.tier})`];

    if (machineScope !== null) {
        lines.push(`  machine scope  ${machineScope}`);
    }
    if (selected !== null) {
        lines.push(...renderSelected(selected));
    }
    lines.push(...renderCandidates("candidates", candidates));
    lines.push(...renderCandidates("set aside for a candidate at a more advanced stage", setAside));
    if (excluded.length > 0) {
        lines.push(`  excluded: ${plural(excluded.length, "task")}`);
        for (const group of byReason(excluded)) {
            lines.push(
                `    ${group.name}: ${group.tasks.length}`,
                ...group.tasks.map((t) => `      ${t.source} → ${t.id} → ${t.title}`),
            );
        }
    }
    if (readyToClose.length > 0) {
        lines.push(
            `  ready to close: ${plural(readyToClose.length, "task")}`,
            ...readyToClose.map((t) => `    ${t.source} → ${t.id} → ${t.title}`),
        );
    }
    if (comparison !== null) {
        lines.push(`  comparison: ${comparison.model} (${comparison.effort})`);
    }
    lines.push("  reasons:", ...result.reasons.map((r) => `    - ${r}`));
    return lines.join("\n");
}

function renderCandidates(heading: string, list: SelectData["candidates"]): string[] {
    if (list.length === 0) {
        return [];
    }
    return [
        `  ${heading}: ${plural(list.length, "task")}`,
        ...list.map((c) => `    ${c.source} → ${c.id} → ${c.title} (${c.scope}, ${c.stage})`),
    ];
}

function renderSelected(selected: SelectedUnit): string[] {
    const lines = [
        `  selected  ${selected.source} → ${selected.id} → ${selected.title}`,
        `    stage        ${selected.stage}`,
        `    autonomy     ${selected.autonomy ?? "none"}`,
        `    scope        ${selected.scope}`,
        `    explanation  ${selected.explanation}`,
    ];
    if (selected.exception !== null) {
        lines.push(`    exception    outside the machine scope: ${selected.exception}`);
    }
    return lines;
}
