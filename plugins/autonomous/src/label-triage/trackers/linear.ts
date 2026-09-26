// Linear tracker (spec label-triage, "Read the open tasks"; label-contract,
// "Label bootstrap"): reads and writes through `linear`, across the whole
// workspace. Completed, canceled and Duplicate issues are dropped from the
// listing; a description is only available from `issue view`.

import type { LinearConfig } from "../../config.ts";
import type { Exec } from "../../exec.ts";
import { array, type Json, object, optional, ParseError, string } from "../../validate.ts";
import type { Tracker, TrackerLabel, TrackerResult, TrackerTask } from "./tracker.ts";

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

function isUnauthenticated(text: string): boolean {
    return text.includes("linear auth login") || text.includes("No API key configured");
}

function mapExecError(command: string, error: string): string {
    if (isUnauthenticated(error)) {
        return `${command}: Linear CLI is not authenticated, run \`linear auth login\``;
    }
    return `${command}: ${error}`;
}

function labelNames(entry: Json, path: string): string[] {
    const labelsPath = `${path}.labels`;
    const nodesPath = `${labelsPath}.nodes`;
    const items = array(object(entry.labels, labelsPath).nodes, nodesPath);
    return items.map((item, index) => {
        const nodePath = `${nodesPath}[${index}]`;
        return string(object(item, nodePath), "name", nodePath);
    });
}

function listedTask(entry: Json, path: string): { task: TrackerTask; type: string } {
    const statePath = `${path}.state`;
    const state = object(entry.state, statePath);
    return {
        task: {
            source: "linear",
            id: string(entry, "identifier", path),
            title: string(entry, "title", path),
            description: null,
            labels: labelNames(entry, path),
            status: string(state, "name", statePath),
            updatedAt: string(entry, "updatedAt", path),
        },
        type: string(state, "type", statePath),
    };
}

function isExcluded(type: string, status: string): boolean {
    return type === "completed" || type === "canceled" || status.toLowerCase() === "duplicate";
}

function parseTasks(command: string, stdout: string): TrackerResult<TrackerTask[]> {
    const parsed = parseJson(command, stdout);
    if (!parsed.ok) {
        return parsed;
    }
    try {
        const root = object(parsed.value, "$");
        const nodes = array(root.nodes, "$.nodes");
        const entries = nodes.map((item, index) =>
            listedTask(object(item, `$.nodes[${index}]`), `$.nodes[${index}]`),
        );
        return {
            ok: true,
            value: entries
                .filter(({ task, type }) => !isExcluded(type, task.status))
                .map(({ task }) => task),
        };
    } catch (error) {
        return { ok: false, error: parseError(command, error) };
    }
}

function nullableDescription(entry: Json, path: string): string | null {
    const value = entry.description;
    if (value === null || value === undefined) {
        return null;
    }
    if (typeof value !== "string") {
        throw new ParseError(`${path}.description must be a string or null`);
    }
    return value;
}

function readTask(entry: Json, path: string): TrackerTask {
    const statePath = `${path}.state`;
    const state = object(entry.state, statePath);
    return {
        source: "linear",
        id: string(entry, "identifier", path),
        title: string(entry, "title", path),
        description: nullableDescription(entry, path),
        labels: labelNames(entry, path),
        status: string(state, "name", statePath),
        updatedAt: optional(entry, "updatedAt", path, string) ?? "",
    };
}

function parseReadTask(command: string, stdout: string): TrackerResult<TrackerTask> {
    const parsed = parseJson(command, stdout);
    if (!parsed.ok) {
        return parsed;
    }
    try {
        return { ok: true, value: readTask(object(parsed.value, "$"), "$") };
    } catch (error) {
        return { ok: false, error: parseError(command, error) };
    }
}

function labelEntry(entry: Json, path: string): TrackerLabel {
    const color = string(entry, "color", path);
    const teamPath = `${path}.team`;
    const teamValue = entry.team;
    const scope =
        teamValue === null ? "workspace" : string(object(teamValue, teamPath), "key", teamPath);
    return { scope, name: string(entry, "name", path), colour: color.toLowerCase() };
}

function parseLabels(command: string, stdout: string): TrackerResult<TrackerLabel[]> {
    const parsed = parseJson(command, stdout);
    if (!parsed.ok) {
        return parsed;
    }
    try {
        const root = object(parsed.value, "$");
        const nodes = array(root.nodes, "$.nodes");
        return {
            ok: true,
            value: nodes.map((item, index) =>
                labelEntry(object(item, `$.nodes[${index}]`), `$.nodes[${index}]`),
            ),
        };
    } catch (error) {
        return { ok: false, error: parseError(command, error) };
    }
}

export function linearTracker(exec: Exec, _config: LinearConfig): Tracker {
    return {
        source: "linear",
        labelScopes: ["workspace"],
        createsLabels: true,

        async listTasks(): Promise<TrackerResult<TrackerTask[]>> {
            const command = "linear issue query --all-teams";
            const result = await exec(["issue", "query", "--all-teams", "--limit", "0", "--json"]);
            if (!result.ok) {
                return { ok: false, error: mapExecError(command, result.error) };
            }
            return parseTasks(command, result.stdout);
        },

        async readTask(id: string): Promise<TrackerResult<TrackerTask>> {
            const command = `linear issue view ${id}`;
            const result = await exec(["issue", "view", id, "--json"]);
            if (!result.ok) {
                return { ok: false, error: mapExecError(command, result.error) };
            }
            return parseReadTask(command, result.stdout);
        },

        async addLabel(id: string, label: string): Promise<TrackerResult<void>> {
            const command = `linear issue update ${id} --add-label ${label}`;
            const result = await exec(["issue", "update", id, "--add-label", label]);
            if (!result.ok) {
                return { ok: false, error: mapExecError(command, result.error) };
            }
            return { ok: true, value: undefined };
        },

        async listLabels(): Promise<TrackerResult<TrackerLabel[]>> {
            const command = "linear label list --all";
            const result = await exec(["label", "list", "--all", "--json"]);
            if (!result.ok) {
                return { ok: false, error: mapExecError(command, result.error) };
            }
            return parseLabels(command, result.stdout);
        },

        async createLabel(
            scope: string,
            name: string,
            colour: string,
        ): Promise<TrackerResult<void>> {
            if (scope !== "workspace") {
                return {
                    ok: false,
                    error: `linear label create: Linear labels are only created at workspace level, got scope "${scope}"`,
                };
            }
            const command = `linear label create -n ${name} -c ${colour}`;
            const result = await exec(["label", "create", "-n", name, "-c", colour]);
            if (!result.ok) {
                return { ok: false, error: mapExecError(command, result.error) };
            }
            return { ok: true, value: undefined };
        },
    };
}
