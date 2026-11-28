import { plural } from "../label-triage/render.ts";
import type { StepResult } from "../runner.ts";
import type { Excluded, Exclusion, SelectData, SelectedUnit } from "./types.ts";

// The exclusions in the order they are checked (design D3), as the report names them.
const EXCLUSION_NAMES: Record<Exclusion, string> = {
    classification: "classification",
    "open-attempt": "open attempt",
    taken: "taken",
    "triage-me": "triage-me",
    "labelled-this-run": "labelled this run",
    "unsupported-stage": "unsupported stage",
    blocked: "blocked",
    split: "split",
    repository: "repository",
    "repository-prerequisites": "repository prerequisites",
    "no-free-slot": "no free slot",
    prerequisites: "prerequisites",
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
    const {
        machineScope,
        selected,
        candidates,
        setAside,
        excluded,
        readyToClose,
        notEvaluated,
        comparison,
    } = result.data;
    const lines = [`[${result.step}] ${result.outcome} (${result.tier})`];

    if (machineScope !== null) {
        lines.push(`  machine scope  ${machineScope}`);
    }
    if (selected !== null) {
        lines.push(...renderSelected(selected));
    }
    lines.push(...renderCandidates("candidates", candidates));
    lines.push(...renderCandidates("set aside for a candidate at a more advanced stage", setAside));
    lines.push(...renderStuck(excluded.filter((task) => task.stuck)));
    lines.push(...renderExcluded(excluded.filter((task) => !task.stuck)));
    if (readyToClose.length > 0) {
        lines.push(
            `  ready to close: ${plural(readyToClose.length, "task")}`,
            ...readyToClose.map((t) => `    ${t.source} → ${t.id} → ${t.title}`),
        );
    }
    lines.push(...notEvaluated.map((part) => `  not evaluated: ${part}`));
    if (comparison !== null) {
        lines.push(`  comparison: ${comparison.model} (${comparison.effort})`);
    }
    lines.push("  reasons:", ...result.reasons.map((r) => `    - ${r}`));
    return lines.join("\n");
}

// Spec work-selection, "Stuck tasks in the report": apart from the other excluded tasks, each
// with what a person needs to release it.
function renderStuck(stuck: readonly Excluded[]): string[] {
    if (stuck.length === 0) {
        return [];
    }
    return [
        `  stuck: ${plural(stuck.length, "task")}`,
        ...stuck.flatMap((t) => [
            `    ${t.source} → ${t.id} → ${t.title} (${t.scope ?? "no scope"}, ${EXCLUSION_NAMES[t.reason]})`,
            ...(t.detail === null ? [] : [`      ${t.detail}`]),
        ]),
    ];
}

function renderExcluded(excluded: readonly Excluded[]): string[] {
    if (excluded.length === 0) {
        return [];
    }
    return [
        `  excluded: ${plural(excluded.length, "task")}`,
        ...byReason(excluded).flatMap((group) => [
            `    ${group.name}: ${group.tasks.length}`,
            ...group.tasks.map((t) => `      ${t.source} → ${t.id} → ${t.title}`),
        ]),
    ];
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
