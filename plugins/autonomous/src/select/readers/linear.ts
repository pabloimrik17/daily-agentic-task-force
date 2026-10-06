import type { LinearConfig } from "../../config.ts";
import type { Exec } from "../../exec.ts";
import { runJson } from "../../label-triage/trackers/cli-json.ts";
import {
    isExcluded,
    listedTask,
    mapExecError,
    nullableDescription,
} from "../../label-triage/trackers/linear.ts";
import { array, type Json, number, object, string } from "../../validate.ts";
import type { WorkReader, WorkTask } from "../types.ts";

function nodes(entry: Json, key: string, path: string): unknown[] {
    return array(object(entry[key], `${path}.${key}`).nodes, `${path}.${key}.nodes`);
}

function openState(type: string | undefined): boolean {
    return type !== "completed" && type !== "canceled";
}

function blockers(entry: Json, path: string): string[] {
    return nodes(entry, "inverseRelations", path).flatMap((item, index) => {
        const relationPath = `${path}.inverseRelations.nodes[${index}]`;
        const relation = object(item, relationPath);
        if (string(relation, "type", relationPath) !== "blocks") return [];
        const issuePath = `${relationPath}.issue`;
        const issue = object(relation.issue, issuePath);
        const statePath = `${issuePath}.state`;
        const type = string(object(issue.state, statePath), "type", statePath);
        const id = string(issue, "identifier", issuePath);
        return openState(type) ? [id] : [];
    });
}

function parseListing(value: unknown) {
    const root = object(value, "$");
    return array(root.nodes, "$.nodes").map((item, index) => {
        const path = `$.nodes[${index}]`;
        const entry = object(item, path);
        return {
            ...listedTask(entry, path),
            priority:
                number(entry, "priority", path) === 0 ? null : string(entry, "priorityLabel", path),
            blockedBy: blockers(entry, path),
        };
    });
}

function parseDetail(
    value: unknown,
    task: WorkTask,
    states: ReadonlyMap<string, string>,
): WorkTask {
    const entry = object(value, "$");
    const children = nodes(entry, "children", "$")
        .map((item, index) => {
            const path = `$.children.nodes[${index}]`;
            const child = object(item, path);
            string(object(child.state, `${path}.state`), "name", `${path}.state`);
            return string(child, "identifier", path);
        })
        .filter((id) => openState(states.get(id)));
    return { ...task, description: nullableDescription(entry, "$"), children };
}

export function linearWorkReader(exec: Exec, _config: LinearConfig): WorkReader {
    let states: ReadonlyMap<string, string> = new Map();
    return {
        source: "linear",
        async list() {
            const result = await runJson(
                exec,
                "linear issue query --all-teams",
                ["issue", "query", "--all-teams", "--limit", "0", "--json"],
                parseListing,
                mapExecError,
            );
            if (!result.ok) return result;
            states = new Map(result.value.map(({ task, type }) => [task.id, type]));
            const tasks: WorkTask[] = result.value
                .filter(({ task, type }) => !isExcluded(type, task.status))
                .map(({ task, priority, blockedBy }) => ({
                    ...task,
                    priority,
                    blockedBy,
                    children: null,
                    blocks: [],
                }));
            for (const task of tasks) {
                task.blocks = tasks
                    .filter((other) => other.blockedBy?.includes(task.id))
                    .map((other) => other.id);
            }
            return { ok: true, value: tasks };
        },
        detail(task) {
            return runJson(
                exec,
                `linear issue view ${task.id}`,
                ["issue", "view", task.id, "--no-comments", "--json"],
                (value) => parseDetail(value, task, states),
                mapExecError,
            );
        },
    };
}
