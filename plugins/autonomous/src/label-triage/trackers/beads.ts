// Beads tracker (spec label-triage, "Read the open tasks"): reads and writes
// through `bd`'s own CLI. Beads has no label objects and no label colours —
// labels exist by use — so `listLabels` synthesises `TrackerLabel`s with a
// null colour and `createLabel` always refuses.

import type { BeadsConfig } from "../../config.ts";
import type { Exec } from "../../exec.ts";
import {
    array,
    type Json,
    object,
    optional,
    ParseError,
    string,
    stringArray,
} from "../../validate.ts";
import { run, runJson } from "./cli-json.ts";
import type { Tracker, TrackerLabel, TrackerResult, TrackerTask } from "./tracker.ts";

const OPEN_STATUSES = new Set(["open", "in_progress"]);

function task(entry: Json, path: string): TrackerTask {
    return {
        source: "beads",
        id: string(entry, "id", path),
        title: string(entry, "title", path),
        description: optional(entry, "description", path, string) ?? "",
        labels: "labels" in entry ? stringArray(entry, "labels", path) : [],
        status: string(entry, "status", path),
        updatedAt: string(entry, "updated_at", path),
    };
}

function parseTasks(value: unknown): TrackerTask[] {
    const items = array(value, "$");
    const tasks = items.map((item, index) => task(object(item, `$[${index}]`), `$[${index}]`));
    return tasks.filter((item) => OPEN_STATUSES.has(item.status));
}

function parseTask(value: unknown): TrackerTask {
    const items = array(value, "$");
    if (items.length !== 1) {
        throw new ParseError("$ must hold exactly one element");
    }
    return task(object(items[0], "$[0]"), "$[0]");
}

function labelEntry(entry: Json, path: string): TrackerLabel {
    return { scope: "beads", name: string(entry, "label", path), colour: null };
}

function parseLabels(value: unknown): TrackerLabel[] {
    const items = array(value, "$");
    return items.map((item, index) => labelEntry(object(item, `$[${index}]`), `$[${index}]`));
}

export function beadsTracker(exec: Exec, config: BeadsConfig): Tracker {
    const dir = config.directory;

    return {
        source: "beads",
        labelScopes: [],
        createsLabels: false,

        listTasks(): Promise<TrackerResult<TrackerTask[]>> {
            return runJson(
                exec,
                "bd list --json",
                ["-C", dir, "list", "--json", "--limit", "0", "--status", "open,in_progress"],
                parseTasks,
            );
        },

        readTask(id: string): Promise<TrackerResult<TrackerTask>> {
            return runJson(
                exec,
                `bd show ${id} --json`,
                ["-C", dir, "show", id, "--json"],
                parseTask,
            );
        },

        addLabel(id: string, label: string): Promise<TrackerResult<void>> {
            return run(exec, `bd label add ${id} ${label}`, ["-C", dir, "label", "add", id, label]);
        },

        listLabels(): Promise<TrackerResult<TrackerLabel[]>> {
            return runJson(
                exec,
                "bd label list-all --json",
                ["-C", dir, "label", "list-all", "--json"],
                parseLabels,
            );
        },

        createLabel(): Promise<TrackerResult<void>> {
            return Promise.resolve({
                ok: false,
                error: "Beads needs no label creation: labels exist by use",
            });
        },
    };
}
