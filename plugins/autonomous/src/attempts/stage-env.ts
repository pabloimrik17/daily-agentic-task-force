import type { AutonomousConfig } from "../config.ts";
import type { RunContext } from "../runner.ts";
import type { WorkTask } from "../select/types.ts";
import type { StageEnv } from "../stages/stage.ts";
import { branchFor } from "../workspace/infer.ts";
import type { AttemptRecord } from "./record.ts";

// One branch per task: the first attempt derives it from the title, every
// later attempt, at any stage, reuses the latest record's.
export function branchOf(records: readonly AttemptRecord[], task: WorkTask): string {
    const latest = records
        .filter((record) => record.task.source === task.source && record.task.id === task.id)
        .reduce<AttemptRecord | null>(
            (best, record) => (best === null || record.attempt > best.attempt ? record : best),
            null,
        );
    return latest?.workspace.branch ?? branchFor(task);
}

export function stageEnv(
    io: RunContext["io"],
    config: AutonomousConfig,
    task: WorkTask,
    repository: string,
    records: readonly AttemptRecord[],
): StageEnv {
    return {
        tool: config.sessions.tool,
        home: io.home,
        task,
        repository,
        branch: branchOf(records, task),
        readers: {
            context: io.context(config)[task.source],
            pullRequests: io.pullRequests(repository),
            openspec: io.openspec,
            git: io.git,
        },
    };
}
