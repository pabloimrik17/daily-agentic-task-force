import type { AutonomousConfig, Source } from "../../config.ts";

export interface TrackerTask {
    source: Source;
    id: string; // beads: bd id; github: "<owner/name>#<number>"; linear: identifier "DOT-82"
    title: string;
    description: string | null; // null when the listing cannot carry it (Linear); readTask fills it
    labels: string[]; // label names exactly as the tracker spells them
    status: string; // tracker's own status/state name, informative only
    updatedAt: string; // RFC 3339 as the tracker prints it ("" if unknown)
}

export interface TrackerLabel {
    scope: string; // where the label lives: beads "beads"; github the repo "owner/name"; linear "workspace" or the team key
    name: string;
    colour: string | null; // normalised "#rrggbb" lower-case, or null when the tracker has no colours (beads)
    id?: string; // linear: the label's id, which a recolour needs; absent on github and beads
}

export type TrackerResult<T> = { ok: true; value: T } | { ok: false; error: string };
// every error message names the CLI command that failed, e.g. `bd list --json …: bd CLI not found on PATH`,
// `linear issue query --all-teams: Linear CLI is not authenticated, run \`linear auth login\``

export interface Tracker {
    source: Source;
    labelScopes: readonly string[]; // scopes the bootstrap must process: beads [], github the configured repos, linear ["workspace"]
    createsLabels: boolean; // beads false (labels exist by use), github true, linear true
    listTasks(): Promise<TrackerResult<TrackerTask[]>>; // only open tasks (per source: see beads.ts, github.ts, linear.ts)
    readTask(id: string): Promise<TrackerResult<TrackerTask>>;
    addLabel(id: string, label: string): Promise<TrackerResult<void>>;
    // Two callers, neither of them triage: the stage sessions remove `taken`; the
    // transition removes the stage it leaves and the autonomy it replaces. Removing a
    // label the task does not carry is tracker-defined: read the task first.
    removeLabel(id: string, label: string): Promise<TrackerResult<void>>;
    listLabels(): Promise<TrackerResult<TrackerLabel[]>>; // all scopes at once
    createLabel(scope: string, name: string, colour: string): Promise<TrackerResult<void>>; // beads: { ok: false, error: "Beads needs no label creation: labels exist by use" }
    // Bootstrap only. Linear needs `label.id`, and a response whose `success` is not true is a failure;
    // beads: { ok: false, error: "Beads has no label colours" }
    recolourLabel(label: TrackerLabel, colour: string): Promise<TrackerResult<void>>;
}

export interface Trackers {
    beads: Tracker;
    github: Tracker;
    linear: Tracker;
}
export type TrackerFactory = (config: AutonomousConfig) => Trackers; // real: CLI-backed from execs; tests: fakes
