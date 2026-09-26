// Linear tracker (spec label-triage, "Read the open tasks"; label-contract,
// "Label bootstrap"): reads and writes through `linear` (schpet/linear-cli
// v2.6.0), across the whole workspace. Completed, canceled and Duplicate issues
// are dropped from the listing; a description is only available from
// `issue view`.

import type { LinearConfig } from "../../config.ts";
import type { Exec } from "../../exec.ts";
import { array, type Json, object, optional, ParseError, string } from "../../validate.ts";
import { run, runJson } from "./cli-json.ts";
import type { Tracker, TrackerLabel, TrackerResult, TrackerTask } from "./tracker.ts";

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

function parseTasks(value: unknown): TrackerTask[] {
    const root = object(value, "$");
    const nodes = array(root.nodes, "$.nodes");
    const entries = nodes.map((item, index) =>
        listedTask(object(item, `$.nodes[${index}]`), `$.nodes[${index}]`),
    );
    return entries
        .filter(({ task, type }) => !isExcluded(type, task.status))
        .map(({ task }) => task);
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

function parseReadTask(value: unknown): TrackerTask {
    return readTask(object(value, "$"), "$");
}

function labelEntry(entry: Json, path: string): TrackerLabel {
    const color = string(entry, "color", path);
    const teamPath = `${path}.team`;
    const teamValue = entry.team;
    const scope =
        teamValue === null ? "workspace" : string(object(teamValue, teamPath), "key", teamPath);
    return { scope, name: string(entry, "name", path), colour: color.toLowerCase() };
}

function parseLabels(value: unknown): TrackerLabel[] {
    const root = object(value, "$");
    const nodes = array(root.nodes, "$.nodes");
    return nodes.map((item, index) =>
        labelEntry(object(item, `$.nodes[${index}]`), `$.nodes[${index}]`),
    );
}

export function linearTracker(exec: Exec, _config: LinearConfig): Tracker {
    return {
        source: "linear",
        labelScopes: ["workspace"],
        createsLabels: true,

        listTasks(): Promise<TrackerResult<TrackerTask[]>> {
            return runJson(
                exec,
                "linear issue query --all-teams",
                ["issue", "query", "--all-teams", "--limit", "0", "--json"],
                parseTasks,
                mapExecError,
            );
        },

        readTask(id: string): Promise<TrackerResult<TrackerTask>> {
            return runJson(
                exec,
                `linear issue view ${id}`,
                ["issue", "view", id, "--no-comments", "--json"],
                parseReadTask,
                mapExecError,
            );
        },

        addLabel(id: string, label: string): Promise<TrackerResult<void>> {
            return run(
                exec,
                `linear issue update ${id} --add-label ${label}`,
                ["issue", "update", id, "--add-label", label],
                mapExecError,
            );
        },

        listLabels(): Promise<TrackerResult<TrackerLabel[]>> {
            return runJson(
                exec,
                "linear label list --all",
                ["label", "list", "--all", "--json"],
                parseLabels,
                mapExecError,
            );
        },

        createLabel(scope: string, name: string, colour: string): Promise<TrackerResult<void>> {
            if (scope !== "workspace") {
                return Promise.resolve({
                    ok: false,
                    error: `linear label create: Linear labels are only created at workspace level, got scope "${scope}"`,
                });
            }
            return run(
                exec,
                `linear label create -n ${name} -c ${colour}`,
                ["label", "create", "-n", name, "-c", colour],
                mapExecError,
            );
        },
    };
}
