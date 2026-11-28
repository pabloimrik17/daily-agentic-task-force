// The select step (spec work-selection): every read fails closed, and a failed
// or rejected comparison makes the step not evaluable with no fallback order.
// It never writes and never contributes questions.

import { listRecords } from "../attempts/state.ts";
import type { CapacityData } from "../capacity/step.ts";
import type { AutonomousConfig, Scope, SelectionConfig } from "../config.ts";
import { plural } from "../label-triage/render.ts";
import type { TrackerResult } from "../label-triage/trackers/tracker.ts";
import { readStuck } from "../loop/files.ts";
import type { Result } from "../result.ts";
import type { RunContext, Step, StepResult, StepTier } from "../runner.ts";
import { listRepositories } from "../workspace/infer.ts";
import {
    labelledThisRun,
    repositoryChecks,
    selectCandidates,
    type SlotsFull,
} from "./candidates.ts";
import { choose } from "./compare.ts";
import { readMachineScope } from "./machine-scope.ts";
import {
    dropRemembered,
    failingPrerequisites,
    type PrerequisiteEnv,
    prerequisitesExcluded,
    rememberedFailures,
} from "./prerequisites.ts";
import { byReason, renderSelect } from "./render.ts";
import { type StageSplit, splitByStage } from "./stage.ts";
import type {
    Candidate,
    Excluded,
    SelectData,
    SelectedUnit,
    SelectionExec,
    WorkReader,
    WorkTask,
} from "./types.ts";

const SELECT = "select";

const GITHUB_NOT_EVALUATED = "github: dependencies";

// The chosen tasks whose prerequisites one run checks (design D4).
const MAX_CHOICES = 4;

const EMPTY: SelectData = {
    machineScope: null,
    selected: null,
    candidates: [],
    setAside: [],
    excluded: [],
    readyToClose: [],
    notEvaluated: [],
    comparison: null,
};

function result(
    outcome: StepResult["outcome"],
    reasons: string[],
    data: SelectData,
    tier: StepTier = "code",
): StepResult<SelectData> {
    return { step: SELECT, tier, outcome, reasons, data };
}

export const selectStep: Step<SelectData> = {
    id: SELECT,
    async run(ctx) {
        if (!ctx.config.ok) {
            return result("not-evaluable", [ctx.config.error], EMPTY);
        }
        const { config } = ctx.config;

        // Design D5: the machine scope comes before any tracker, so a misconfigured
        // machine fails fast and builds no reader.
        const scope = await readMachineScope(ctx.io.chezmoi);
        if (!scope.ok) {
            return result("not-evaluable", [scope.error], EMPTY);
        }
        const read = await readTasks(ctx.io.work(config));
        const notEvaluated = config.sources.github.enabled ? [GITHUB_NOT_EVALUATED] : [];
        const known = { ...EMPTY, machineScope: scope.scope, notEvaluated };
        if (!read.ok) {
            return result("not-evaluable", [read.error], known);
        }

        return selectAmong(ctx, config, scope.scope, read.value, known);
    },
    render: renderSelect,
};

// Only an iteration of the loop binds the slots, and only when `capacity` could tell.
export function slots(ctx: RunContext): { full?: SlotsFull } {
    const capacity = ctx.results.find((r) => r.step === "capacity")?.data as
        | CapacityData
        | null
        | undefined;
    if (!ctx.args.loop || capacity === null || capacity === undefined) {
        return {};
    }
    return { full: { grill: capacity.grill.full, work: capacity.work.full } };
}

// A read error carries the command; the source in front of it names the
// tracker, as label-triage does.
function inSource<T>(source: WorkReader["source"], read: TrackerResult<T>): TrackerResult<T> {
    return read.ok ? read : { ok: false, error: `${source}: ${read.error}` };
}

// Lists every reader in order and returns the tasks with a `detail` that goes to
// the reader of the task's own source.
async function readTasks(readers: WorkReader[]): Promise<
    TrackerResult<{
        tasks: WorkTask[];
        detail: (task: WorkTask) => Promise<TrackerResult<WorkTask>>;
    }>
> {
    const tasks: WorkTask[] = [];
    for (const reader of readers) {
        const listed = inSource(reader.source, await reader.list());
        if (!listed.ok) {
            return listed;
        }
        tasks.push(...listed.value);
    }
    const bySource = new Map(readers.map((reader) => [reader.source, reader]));
    const detail = async (task: WorkTask) =>
        inSource(task.source, await bySource.get(task.source)!.detail(task));
    return { ok: true, value: { tasks, detail } };
}

function summary({ task, scope, stage }: Candidate): SelectData["candidates"][number] {
    return { source: task.source, id: task.id, title: task.title, scope, stage };
}

function waitReasons(excluded: readonly Excluded[]): string[] {
    const reasons = byReason(excluded).map((group) => `${group.tasks.length} ${group.name}`);
    return reasons.length > 0 ? reasons : ["no open task"];
}

type Tasks = Extract<Awaited<ReturnType<typeof readTasks>>, { ok: true }>["value"];

interface Read extends PrerequisiteEnv {
    remembered: ReadonlySet<string>;
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

// `loop.stuck` is read only in a loop iteration: it belongs to the running loop (design D6).
async function readChecks(ctx: RunContext, config: AutonomousConfig): Promise<Result<Read>> {
    try {
        const records = await listRecords(ctx.io.state);
        const repositories = await listRepositories(config.workspace.root);
        const remembered = ctx.args.loop
            ? rememberedFailures(await readStuck(ctx.io.state))
            : new Set<string>();
        return { ok: true, value: { io: ctx.io, config, records, repositories, remembered } };
    } catch (error) {
        return { ok: false, error: messageOf(error) };
    }
}

async function selectAmong(
    ctx: RunContext,
    config: AutonomousConfig,
    machineScope: Scope,
    { tasks, detail }: Tasks,
    known: SelectData,
): Promise<StepResult<SelectData>> {
    const read = await readChecks(ctx, config);
    if (!read.ok) {
        return result("not-evaluable", [read.error], known);
    }
    const found = await selectCandidates(tasks, {
        config,
        labelledThisRun: labelledThisRun(ctx.results),
        detail,
        ...slots(ctx),
        records: read.value.records,
        workspace: repositoryChecks(read.value.repositories),
    });
    if (!found.ok) {
        return result("not-evaluable", [found.error], known);
    }
    const kept = await dropRemembered(read.value, found.value.candidates, read.value.remembered);
    if (!kept.ok) {
        return result("not-evaluable", [kept.error], known);
    }
    const excluded = [...found.value.excluded, ...kept.value.excluded];
    const data = { ...known, excluded, readyToClose: found.value.readyToClose };
    const election = { machineScope, settings: config.selection, selection: ctx.io.selection };
    return kept.value.candidates.length === 0
        ? result("wait", waitReasons(excluded), data)
        : elect(kept.value.candidates, { ...election, env: read.value }, data);
}

interface Election {
    machineScope: Scope;
    settings: SelectionConfig;
    selection: SelectionExec;
    env: PrerequisiteEnv;
}

type Round = { split: StageSplit<Candidate>; tier: StepTier } & (
    | { kind: "selected"; selected: SelectedUnit }
    | { kind: "failed"; chosen: Candidate; reason: string }
    | { kind: "broken"; error: string }
);

async function round(remaining: readonly Candidate[], election: Election): Promise<Round> {
    const split = splitByStage(remaining);
    const { machineScope, settings, selection, env } = election;
    const chosen = await choose(split.kept, machineScope, settings, selection);
    if (!chosen.ok) {
        return { split, tier: chosen.tier, kind: "broken", error: chosen.error };
    }
    const { selected, tier } = chosen;
    const candidate = split.kept.find(
        ({ task }) => task.source === selected.source && task.id === selected.id,
    )!; // validateSelection accepts only a candidate
    const failing = await failingPrerequisites(env, candidate);
    if (!failing.ok) {
        return { split, tier, kind: "broken", error: failing.error };
    }
    return failing.value === null
        ? { split, tier, kind: "selected", selected }
        : { split, tier, kind: "failed", chosen: candidate, reason: failing.value };
}

async function elect(
    candidates: readonly Candidate[],
    election: Election,
    data: SelectData,
): Promise<StepResult<SelectData>> {
    let remaining = [...candidates];
    const failed: Excluded[] = [];
    let tier: StepTier = "code";
    while (remaining.length > 0 && failed.length < MAX_CHOICES) {
        const next = await round(remaining, election);
        tier = next.tier === "llm" ? "llm" : tier;
        if (next.kind !== "failed") {
            return ended(next, { data, failed, tier, settings: election.settings });
        }
        failed.push(prerequisitesExcluded(next.chosen, next.reason));
        remaining = remaining.filter((candidate) => candidate !== next.chosen);
    }
    const split = remaining.length > 0 ? splitByStage(remaining) : { kept: [], setAside: [] };
    const excluded = [...data.excluded, ...failed];
    const reasons = [choicesFailed(failed.length), ...waitReasons(excluded)];
    return result(
        "wait",
        reasons,
        outcomeData({ data, failed, tier, settings: election.settings }, split),
        tier,
    );
}

interface Outcome {
    data: SelectData;
    failed: readonly Excluded[];
    tier: StepTier;
    settings: SelectionConfig;
}

function outcomeData(
    { data, failed, tier, settings }: Outcome,
    { kept, setAside }: StageSplit<Candidate>,
): SelectData {
    return {
        ...data,
        candidates: kept.map(summary),
        setAside: setAside.map(summary),
        excluded: [...data.excluded, ...failed],
        comparison: tier === "llm" ? { model: settings.model, effort: settings.effort } : null,
    };
}

function ended(next: Exclude<Round, { kind: "failed" }>, outcome: Outcome): StepResult<SelectData> {
    const data = outcomeData(outcome, next.split);
    if (next.kind === "broken") {
        return result("not-evaluable", [next.error], data, outcome.tier);
    }
    const { selected } = next;
    const reason = `selected ${selected.source} → ${selected.id} for ${selected.stage}, from ${plural(next.split.kept.length, "candidate")}`;
    return result("advance", [reason], { ...data, selected }, outcome.tier);
}

function choicesFailed(count: number): string {
    return count === 1
        ? "1 choice failed its prerequisites"
        : `${count} choices failed their prerequisites`;
}
