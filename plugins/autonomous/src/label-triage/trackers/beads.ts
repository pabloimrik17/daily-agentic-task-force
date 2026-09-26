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
import type { Tracker, TrackerLabel, TrackerResult, TrackerTask } from "./tracker.ts";

const OPEN_STATUSES = new Set(["open", "in_progress"]);

function parseError(command: string, error: unknown): string {
    if (error instanceof ParseError) {
        return `${command}: output does not match the expected shape: ${error.message}`;
    }
    return `${command}: output is not valid JSON: ${(error as Error).message}`;
}

function parseJson(
    command: string,
    stdout: string,
): { ok: true; value: unknown } | { ok: false; error: string } {
    try {
        return { ok: true, value: JSON.parse(stdout) };
    } catch (error) {
        return { ok: false, error: parseError(command, error) };
    }
}

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

function parseTasks(command: string, stdout: string): TrackerResult<TrackerTask[]> {
    const parsed = parseJson(command, stdout);
    if (!parsed.ok) {
        return parsed;
    }
    try {
        const items = array(parsed.value, "$");
        const tasks = items.map((item, index) => task(object(item, `$[${index}]`), `$[${index}]`));
        return { ok: true, value: tasks.filter((item) => OPEN_STATUSES.has(item.status)) };
    } catch (error) {
        return { ok: false, error: parseError(command, error) };
    }
}

function parseTask(command: string, stdout: string): TrackerResult<TrackerTask> {
    const parsed = parseJson(command, stdout);
    if (!parsed.ok) {
        return parsed;
    }
    try {
        const items = array(parsed.value, "$");
        if (items.length !== 1) {
            return {
                ok: false,
                error: `${command}: output does not match the expected shape: $ must hold exactly one element`,
            };
        }
        return { ok: true, value: task(object(items[0], "$[0]"), "$[0]") };
    } catch (error) {
        return { ok: false, error: parseError(command, error) };
    }
}

function labelEntry(entry: Json, path: string): TrackerLabel {
    return { scope: "beads", name: string(entry, "label", path), colour: null };
}

function parseLabels(command: string, stdout: string): TrackerResult<TrackerLabel[]> {
    const parsed = parseJson(command, stdout);
    if (!parsed.ok) {
        return parsed;
    }
    try {
        const items = array(parsed.value, "$");
        return {
            ok: true,
            value: items.map((item, index) =>
                labelEntry(object(item, `$[${index}]`), `$[${index}]`),
            ),
        };
    } catch (error) {
        return { ok: false, error: parseError(command, error) };
    }
}

export function beadsTracker(exec: Exec, config: BeadsConfig): Tracker {
    const dir = config.directory;

    return {
        source: "beads",
        labelScopes: [],
        createsLabels: false,

        async listTasks(): Promise<TrackerResult<TrackerTask[]>> {
            const command = "bd list --json";
            const result = await exec([
                "-C",
                dir,
                "list",
                "--json",
                "--limit",
                "0",
                "--status",
                "open,in_progress",
            ]);
            if (!result.ok) {
                return { ok: false, error: `${command}: ${result.error}` };
            }
            return parseTasks(command, result.stdout);
        },

        async readTask(id: string): Promise<TrackerResult<TrackerTask>> {
            const command = `bd show ${id} --json`;
            const result = await exec(["-C", dir, "show", id, "--json"]);
            if (!result.ok) {
                return { ok: false, error: `${command}: ${result.error}` };
            }
            return parseTask(command, result.stdout);
        },

        async addLabel(id: string, label: string): Promise<TrackerResult<void>> {
            const command = `bd label add ${id} ${label}`;
            const result = await exec(["-C", dir, "label", "add", id, label]);
            if (!result.ok) {
                return { ok: false, error: `${command}: ${result.error}` };
            }
            return { ok: true, value: undefined };
        },

        async listLabels(): Promise<TrackerResult<TrackerLabel[]>> {
            const command = "bd label list-all --json";
            const result = await exec(["-C", dir, "label", "list-all", "--json"]);
            if (!result.ok) {
                return { ok: false, error: `${command}: ${result.error}` };
            }
            return parseLabels(command, result.stdout);
        },

        createLabel(): Promise<TrackerResult<void>> {
            return Promise.resolve({
                ok: false,
                error: "Beads needs no label creation: labels exist by use",
            });
        },
    };
}
