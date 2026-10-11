import type { BeadsConfig } from "../../config.ts";
import type { Exec } from "../../exec.ts";
import { task as beadsTask } from "../../label-triage/trackers/beads.ts";
import { runJson } from "../../label-triage/trackers/cli-json.ts";
import { array, number, object, optional, string, stringArray } from "../../validate.ts";
import type { WorkReader, WorkTask } from "../types.ts";

function parseListing(value: unknown) {
    return array(value, "$").map((item, index) => {
        const path = `$[${index}]`;
        const entry = object(item, path);
        return {
            task: beadsTask(entry, path),
            priority: `P${number(entry, "priority", path)}`,
            parent: optional(entry, "parent", path, string),
        };
    });
}

function parseBlocked(value: unknown): Map<string, string[]> {
    return new Map(
        array(value, "$").map((item, index) => {
            const path = `$[${index}]`;
            const entry = object(item, path);
            return [string(entry, "id", path), stringArray(entry, "blocked_by", path)];
        }),
    );
}

export function beadsWorkReader(exec: Exec, config: BeadsConfig): WorkReader {
    return {
        source: "beads",
        async list() {
            const listed = await runJson(
                exec,
                "bd list --json",
                [
                    "-C",
                    config.directory,
                    "list",
                    "--json",
                    "--limit",
                    "0",
                    "--status",
                    "open,in_progress,blocked,deferred",
                ],
                parseListing,
            );
            if (!listed.ok) return listed;
            const blocked = await runJson(
                exec,
                "bd blocked --json",
                ["-C", config.directory, "blocked", "--json"],
                parseBlocked,
            );
            if (!blocked.ok) return blocked;
            const tasks: WorkTask[] = listed.value
                .filter(({ task }) => task.status === "open" || task.status === "in_progress")
                .map(({ task, priority }) => ({
                    ...task,
                    priority,
                    blockedBy: blocked.value.get(task.id) ?? [],
                    blocks: [...blocked.value]
                        .filter(
                            ([id, blockers]) =>
                                blockers.includes(task.id) &&
                                listed.value.some(
                                    ({ task: other }) =>
                                        other.id === id && other.status !== "closed",
                                ),
                        )
                        .map(([id]) => id),
                    children: listed.value
                        .filter(
                            (entry) => entry.parent === task.id && entry.task.status !== "closed",
                        )
                        .map((entry) => entry.task.id),
                }));
            return { ok: true, value: tasks };
        },
        detail(task) {
            return Promise.resolve({ ok: true, value: task });
        },
    };
}
