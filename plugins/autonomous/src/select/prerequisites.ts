import { stageEnv } from "../attempts/stage-env.ts";
import { type AttemptRecord, taskKey } from "../attempts/record.ts";
import type { AutonomousConfig } from "../config.ts";
import { type StuckEntry, UNREAD_ONCE } from "../loop/files.ts";
import type { RunContext } from "../runner.ts";
import { STAGES } from "../stages/registry.ts";
import { isStageId, type StagePrerequisites } from "../stages/stage.ts";
import { inferRepository } from "../workspace/infer.ts";
import { excludedTask } from "./excluded.ts";
import type { Candidate, Excluded, Exclusion, Unreadable } from "./types.ts";

// The task keys `loop.stuck` holds: those excluded for their prerequisites, and those whose
// prerequisites could not be read, whether or not a task was excluded for it yet.
export interface Remembered {
    failed: ReadonlySet<string>;
    unreadable: ReadonlySet<string>;
}

export function rememberedTasks(entries: readonly StuckEntry[]): Remembered {
    const tasks = (...exclusions: string[]) =>
        new Set(
            entries.filter(({ exclusion }) => exclusions.includes(exclusion)).map((e) => e.task),
        );
    const set: Exclusion = "unreadable-prerequisites";
    return { failed: tasks("prerequisites"), unreadable: tasks(UNREAD_ONCE, set) };
}

export interface PrerequisiteEnv {
    io: RunContext["io"];
    config: AutonomousConfig;
    records: readonly AttemptRecord[];
    repositories: readonly string[];
    remembered: Remembered; // empty outside an iteration of the loop
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

type Checked = { kind: "hold" } | { kind: "failed" | "unreadable"; reason: string };

function verdict(ready: StagePrerequisites): Checked {
    if (ready.ok) {
        return { kind: "hold" };
    }
    return { kind: ready.unreadable === true ? "unreadable" : "failed", reason: ready.reason };
}

// A candidate passed the stage and repository checks, so a stage or repository missing here means
// there is nothing to check. A check that throws could not read what it needs.
async function check(env: PrerequisiteEnv, { task, stage }: Candidate): Promise<Checked> {
    const found = isStageId(stage) ? STAGES.get(stage) : undefined;
    const inferred = inferRepository(task, env.repositories);
    if (found === undefined || !inferred.ok) {
        return { kind: "hold" };
    }
    try {
        const { io, config, records } = env;
        return verdict(
            await found.prerequisites(stageEnv(io, config, task, inferred.repository, records)),
        );
    } catch (error) {
        return {
            kind: "unreadable",
            reason: `the ${stage} prerequisites of ${task.source}:${task.id} cannot be read: ${messageOf(error)}`,
        };
    }
}

export type Judged =
    | { kind: "hold" }
    | { kind: "excluded"; excluded: Excluded }
    | { kind: "unreadable"; unreadable: Unreadable };

// Design D8 and D9: prerequisites that cannot be read make the step not evaluable the first
// time, so a problem of the whole machine excludes nothing; a task remembered for it is excluded
// instead, so one task cannot hold the loop.
export async function judgePrerequisites(
    env: PrerequisiteEnv,
    candidate: Candidate,
): Promise<Judged> {
    const checked = await check(env, candidate);
    if (checked.kind === "hold") {
        return checked;
    }
    const { task } = candidate;
    const { reason: detail } = checked;
    if (checked.kind === "failed") {
        return {
            kind: "excluded",
            excluded: excludedTask(task, { reason: "prerequisites", detail }),
        };
    }
    return env.remembered.unreadable.has(taskKey(task.source, task.id))
        ? {
              kind: "excluded",
              excluded: excludedTask(task, { reason: "unreadable-prerequisites", detail }),
          }
        : { kind: "unreadable", unreadable: { source: task.source, id: task.id, reason: detail } };
}

interface Kept {
    candidates: Candidate[];
    excluded: Excluded[];
}

type Dropped = { ok: true; value: Kept } | { ok: false; unreadable: Unreadable };

// Design D6: a remembered task is checked before the comparison, so it costs no comparison while
// its prerequisites still fail or still cannot be read.
export async function dropRemembered(
    env: PrerequisiteEnv,
    candidates: readonly Candidate[],
): Promise<Dropped> {
    const { failed, unreadable } = env.remembered;
    const kept: Kept = { candidates: [], excluded: [] };
    for (const found of candidates) {
        const key = taskKey(found.task.source, found.task.id);
        const judged: Judged =
            failed.has(key) || unreadable.has(key)
                ? await judgePrerequisites(env, found)
                : { kind: "hold" };
        if (judged.kind === "unreadable") {
            return { ok: false, unreadable: judged.unreadable };
        }
        if (judged.kind === "hold") {
            kept.candidates.push(found);
        } else {
            kept.excluded.push(judged.excluded);
        }
    }
    return { ok: true, value: kept };
}
