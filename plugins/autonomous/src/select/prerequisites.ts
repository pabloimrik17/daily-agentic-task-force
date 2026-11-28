import { stageEnv } from "../attempts/stage-env.ts";
import { type AttemptRecord, type TaskKey, taskKey } from "../attempts/record.ts";
import type { AutonomousConfig } from "../config.ts";
import type { StuckEntry } from "../loop/files.ts";
import type { Result } from "../result.ts";
import type { RunContext } from "../runner.ts";
import { STAGES } from "../stages/registry.ts";
import { isStageId, type StagePrerequisites } from "../stages/stage.ts";
import { inferRepository } from "../workspace/infer.ts";
import { excludedTask } from "./excluded.ts";
import type { Candidate, Excluded } from "./types.ts";

export interface PrerequisiteEnv {
    io: RunContext["io"];
    config: AutonomousConfig;
    records: readonly AttemptRecord[];
    repositories: readonly string[];
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

// Design D8: a prerequisite that cannot be read is an error, never a reason to exclude the task.
function verdict(ready: StagePrerequisites): Result<string | null> {
    if (ready.ok) {
        return { ok: true, value: null };
    }
    return ready.unreadable === true
        ? { ok: false, error: ready.reason }
        : { ok: true, value: ready.reason };
}

// The failing prerequisite's reason, or null when they hold. A candidate passed the stage and
// repository checks, so a stage or repository missing here means there is nothing to check.
export async function failingPrerequisites(
    env: PrerequisiteEnv,
    { task, stage }: Candidate,
): Promise<Result<string | null>> {
    const found = isStageId(stage) ? STAGES.get(stage) : undefined;
    const inferred = inferRepository(task, env.repositories);
    if (found === undefined || !inferred.ok) {
        return { ok: true, value: null };
    }
    try {
        const { io, config, records } = env;
        const ready = await found.prerequisites(
            stageEnv(io, config, task, inferred.repository, records),
        );
        return verdict(ready);
    } catch (error) {
        return {
            ok: false,
            error: `the ${stage} prerequisites of ${task.source}:${task.id} cannot be read: ${messageOf(error)}`,
        };
    }
}

export function prerequisitesExcluded({ task }: Candidate, reason: string): Excluded {
    return excludedTask(task, { reason: "prerequisites", detail: reason });
}

export function rememberedFailures(entries: readonly StuckEntry[]): Set<string> {
    return new Set(
        entries.filter((entry) => entry.exclusion === "prerequisites").map((entry) => entry.task),
    );
}

interface Remembered {
    candidates: Candidate[];
    excluded: Excluded[];
}

// Design D6: a remembered task whose prerequisites still fail never reaches the comparison.
export async function dropRemembered(
    env: PrerequisiteEnv,
    candidates: readonly Candidate[],
    remembered: ReadonlySet<string>,
): Promise<Result<Remembered>> {
    const kept: Remembered = { candidates: [], excluded: [] };
    for (const found of candidates) {
        const key: TaskKey = taskKey(found.task.source, found.task.id);
        const failing = remembered.has(key)
            ? await failingPrerequisites(env, found)
            : { ok: true as const, value: null };
        if (!failing.ok) {
            return failing;
        }
        if (failing.value === null) {
            kept.candidates.push(found);
        } else {
            kept.excluded.push(prerequisitesExcluded(found, failing.value));
        }
    }
    return { ok: true, value: kept };
}
