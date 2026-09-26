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
}

export type TrackerResult<T> = { ok: true; value: T } | { ok: false; error: string };
// every error message names the CLI command that failed, e.g. `bd list --json …: bd CLI not found on PATH`,
// `linear issue query --all-teams: Linear CLI is not authenticated, run \`linear auth login\``

export interface Tracker {
    source: Source;
    labelScopes: readonly string[]; // scopes the bootstrap must process: beads [], github the configured repos, linear ["workspace"]
    createsLabels: boolean; // beads false (labels exist by use), github true, linear true
    listTasks(): Promise<TrackerResult<TrackerTask[]>>; // only open tasks (see cli-facts.md per source)
    readTask(id: string): Promise<TrackerResult<TrackerTask>>;
    addLabel(id: string, label: string): Promise<TrackerResult<void>>;
    listLabels(): Promise<TrackerResult<TrackerLabel[]>>; // all scopes at once
    createLabel(scope: string, name: string, colour: string): Promise<TrackerResult<void>>; // beads: { ok: false, error: "Beads needs no label creation: labels exist by use" }
}

export interface Trackers {
    beads: Tracker;
    github: Tracker;
    linear: Tracker;
}
export type TrackerFactory = (config: AutonomousConfig) => Trackers; // real: CLI-backed from execs; tests: fakes
