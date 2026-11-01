// Label bootstrap (spec label-contract, "Label bootstrap"): makes every
// contract label exist on every enabled source with the contract's colour. It
// creates a missing label and recolours an existing one whose colour differs,
// in each scope where it appears; a label outside the contract is never
// touched or reported. Unlike the triage step, one failing source does not
// stop the others.

import type { AutonomousConfig, ContractLabel, Source } from "../config.ts";
import type { Tracker, TrackerLabel, Trackers } from "../label-triage/trackers/tracker.ts";
import { COLOURS, LABELS } from "./contract.ts";

export interface BootstrapLabel {
    scope: string;
    label: ContractLabel;
    status: "created" | "recoloured" | "present" | "failed";
    colour: string | null;
    expected: string | null;
    note: string | null;
}

export interface BootstrapSource {
    source: Source;
    applicable: boolean;
    evaluable: boolean;
    reason: string | null;
    labels: BootstrapLabel[];
}

export interface BootstrapReport {
    schema: "autonomous.bootstrap.v1";
    startedAt: string;
    outcome: "advance" | "not-evaluable";
    sources: BootstrapSource[];
    // Present only when the configuration failed to load, leaving no sources.
    config?: { path: string; error: string };
}

const SOURCES: readonly Source[] = ["beads", "github", "linear"];

const NOT_APPLICABLE = "Beads needs no label creation: labels exist by use";

export async function bootstrapLabels(
    trackers: Trackers,
    config: AutonomousConfig,
    startedAt: Date,
): Promise<BootstrapReport> {
    const sources: BootstrapSource[] = [];
    for (const source of SOURCES) {
        if (config.sources[source].enabled) {
            sources.push(await bootstrapSource(trackers[source]));
        }
    }
    const complete = sources.every(
        (entry) => entry.evaluable && entry.labels.every((label) => label.status !== "failed"),
    );
    return {
        schema: "autonomous.bootstrap.v1",
        startedAt: startedAt.toISOString(),
        outcome: complete ? "advance" : "not-evaluable",
        sources,
    };
}

// With --json a configuration that fails to load still yields one document,
// as it does inside the run report.
export function unconfiguredBootstrap(
    path: string,
    error: string,
    startedAt: Date,
): BootstrapReport {
    return {
        schema: "autonomous.bootstrap.v1",
        startedAt: startedAt.toISOString(),
        outcome: "not-evaluable",
        sources: [],
        config: { path, error },
    };
}

async function bootstrapSource(tracker: Tracker): Promise<BootstrapSource> {
    const base = { source: tracker.source, applicable: true, evaluable: true, reason: null };
    if (!tracker.createsLabels) {
        return { ...base, applicable: false, reason: NOT_APPLICABLE, labels: [] };
    }
    if (tracker.labelScopes.length === 0) {
        return { ...base, labels: [] };
    }
    const listed = await tracker.listLabels();
    if (!listed.ok) {
        return { ...base, evaluable: false, reason: listed.error, labels: [] };
    }
    const labels: BootstrapLabel[] = [];
    for (const scope of tracker.labelScopes) {
        for (const label of LABELS) {
            labels.push(...(await bootstrapLabel(tracker, listed.value, scope, label)));
        }
    }
    return { ...base, labels };
}

async function bootstrapLabel(
    tracker: Tracker,
    listed: TrackerLabel[],
    scope: string,
    label: ContractLabel,
): Promise<BootstrapLabel[]> {
    const existing = findExisting(tracker, listed, scope, label);
    if (!existing) {
        return [await create(tracker, scope, label)];
    }
    const stale = sameName(tracker, listed, scope, label).filter((entry) =>
        hasOtherColour(entry, label),
    );
    const existingIsStale = stale.some((entry) => entry === existing);
    const reported: BootstrapLabel[] = existingIsStale ? [] : [present(label, existing)];
    for (const entry of stale) {
        reported.push(await recolour(tracker, entry, label, entry.colour));
    }
    return reported;
}

// Every listed label the bootstrap looks at for one contract label: on Linear the
// workspace and every team, whose labels are separate objects; on GitHub only the
// repository in scope.
function sameName(
    tracker: Tracker,
    listed: TrackerLabel[],
    scope: string,
    label: ContractLabel,
): TrackerLabel[] {
    return listed.filter(
        (entry) => entry.name === label && (tracker.source === "linear" || entry.scope === scope),
    );
}

function hasOtherColour(
    entry: TrackerLabel,
    label: ContractLabel,
): entry is TrackerLabel & { colour: string } {
    return entry.colour !== null && entry.colour.toLowerCase() !== COLOURS[label];
}

// On Linear a same-name label in any team already exists for the contract, and a
// workspace label beside it would be a duplicate; GitHub labels are per repository.
function findExisting(
    tracker: Tracker,
    listed: TrackerLabel[],
    scope: string,
    label: ContractLabel,
): TrackerLabel | undefined {
    const inScope = listed.find((entry) => entry.scope === scope && entry.name === label);
    if (inScope || tracker.source !== "linear") {
        return inScope;
    }
    return listed.find((entry) => entry.name === label);
}

function present(label: ContractLabel, existing: TrackerLabel): BootstrapLabel {
    return {
        scope: existing.scope,
        label,
        status: "present",
        colour: existing.colour,
        expected: null,
        note: null,
    };
}

async function recolour(
    tracker: Tracker,
    existing: TrackerLabel,
    label: ContractLabel,
    old: string,
): Promise<BootstrapLabel> {
    const colour = COLOURS[label];
    const result = await tracker.recolourLabel(existing, colour);
    const base = { scope: existing.scope, label, expected: null };
    if (!result.ok) {
        return { ...base, status: "failed", colour: null, note: result.error };
    }
    return { ...base, status: "recoloured", colour, note: `was ${old}` };
}

async function create(
    tracker: Tracker,
    scope: string,
    label: ContractLabel,
): Promise<BootstrapLabel> {
    const colour = COLOURS[label];
    const result = await tracker.createLabel(scope, label, colour);
    if (!result.ok) {
        return { scope, label, status: "failed", colour: null, expected: null, note: result.error };
    }
    return { scope, label, status: "created", colour, expected: null, note: null };
}

export function renderBootstrapJson(report: BootstrapReport): string {
    return JSON.stringify(report, null, 2);
}

export function renderBootstrapText(report: BootstrapReport): string {
    const header = `label bootstrap — started ${report.startedAt}\noutcome: ${report.outcome}`;
    return [header, ...report.sources.flatMap(renderSource)].join("\n");
}

function renderSource(entry: BootstrapSource): string[] {
    const prefix = `  ${entry.source.padEnd(10)}`;
    if (!entry.applicable) {
        return [`${prefix}not applicable — ${entry.reason ?? ""}`];
    }
    if (!entry.evaluable) {
        return [`${prefix}not evaluable — ${entry.reason ?? ""}`];
    }
    const scopes = [...new Set(entry.labels.map((label) => label.scope))];
    if (scopes.length === 0) {
        return [`${prefix}no label scopes to bootstrap`];
    }
    return scopes.map((scope) => {
        const labels = entry.labels.filter((label) => label.scope === scope);
        return `${prefix}${scope}: ${renderScope(labels)}`;
    });
}

function renderScope(labels: BootstrapLabel[]): string {
    const statuses: readonly BootstrapLabel["status"][] = [
        "created",
        "recoloured",
        "present",
        "failed",
    ];
    return statuses
        .map((status) => {
            const items = labels.filter((label) => label.status === status).map(renderItem);
            return items.length === 0 ? null : `${status} ${items.join(", ")}`;
        })
        .filter((group) => group !== null)
        .join("; ");
}

function renderItem(label: BootstrapLabel): string {
    if (label.status === "failed" || label.status === "recoloured") {
        return `${label.label} (${label.note ?? ""})`;
    }
    return label.label;
}
