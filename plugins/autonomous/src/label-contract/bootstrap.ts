// Label bootstrap (spec label-contract, "Label bootstrap"): makes every
// contract label exist on every enabled source. It only ever creates missing
// labels; an existing label is left as it is, even with a differing colour,
// which it reports. Unlike the triage step, one failing source does not stop
// the others (design D9).

import type { AutonomousConfig, ContractLabel, Source } from "../config.ts";
import type { Tracker, TrackerLabel, Trackers } from "../label-triage/trackers/tracker.ts";
import { COLOURS, LABELS } from "./contract.ts";

export interface BootstrapLabel {
    scope: string;
    label: ContractLabel;
    status: "created" | "present" | "failed";
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
            const existing = findExisting(tracker, listed.value, scope, label);
            labels.push(existing ? present(label, existing) : await create(tracker, scope, label));
        }
    }
    return { ...base, labels };
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
    const expected = COLOURS[label];
    const differs = existing.colour !== null && existing.colour.toLowerCase() !== expected;
    return {
        scope: existing.scope,
        label,
        status: "present",
        colour: existing.colour,
        expected: differs ? expected : null,
        note: differs ? "colour differs" : null,
    };
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
    const statuses: readonly BootstrapLabel["status"][] = ["created", "present", "failed"];
    return statuses
        .map((status) => {
            const items = labels.filter((label) => label.status === status).map(renderItem);
            return items.length === 0 ? null : `${status} ${items.join(", ")}`;
        })
        .filter((group) => group !== null)
        .join("; ");
}

function renderItem(label: BootstrapLabel): string {
    if (label.status === "failed") {
        return `${label.label} (${label.note ?? ""})`;
    }
    if (label.expected !== null) {
        return `${label.label} (colour ${label.colour ?? "none"}, expected ${label.expected})`;
    }
    return label.label;
}
