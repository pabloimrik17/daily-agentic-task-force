import type { GithubConfig } from "../../config.ts";
import type { Exec } from "../../exec.ts";
import { githubTracker } from "../../label-triage/trackers/github.ts";
import type { WorkReader, WorkTask } from "../types.ts";

export function githubWorkReader(exec: Exec, config: GithubConfig): WorkReader {
    const tracker = githubTracker(exec, config);
    return {
        source: "github",
        async list() {
            const result = await tracker.listTasks();
            if (!result.ok) return result;
            const tasks: WorkTask[] = result.value.map((task) => ({
                ...task,
                priority: null,
                blockedBy: null,
                children: null,
                blocks: [],
            }));
            return { ok: true, value: tasks };
        },
        detail(task) {
            return Promise.resolve({ ok: true, value: task });
        },
    };
}
