// The select step (spec work-selection; design D1, D5, D9, D10): reads the
// machine scope first, then the open tasks of every enabled source again,
// excludes by the ordered checks and chooses among the candidates — by code for
// a single one, by the LLM for two or more. Every read fails closed, and a
// failed or rejected comparison makes the step not evaluable with no fallback
// order. It never writes and never contributes questions.

import type { Scope, SelectionConfig } from "../config.ts";
import { plural } from "../label-triage/render.ts";
import type { TrackerResult } from "../label-triage/trackers/tracker.ts";
import type { Step, StepResult, StepTier } from "../runner.ts";
import { labelledThisRun, selectCandidates } from "./candidates.ts";
import { choose } from "./compare.ts";
import { readMachineScope } from "./machine-scope.ts";
import { byReason, renderSelect } from "./render.ts";
import type {
    Candidate,
    Excluded,
    SelectData,
    SelectionExec,
    WorkReader,
    WorkTask,
} from "./types.ts";

const SELECT = "select";

const GITHUB_NOT_EVALUATED = "github: dependencies and children";

const EMPTY: SelectData = {
    machineScope: null,
    selected: null,
    candidates: [],
    excluded: [],
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

        const found = await selectCandidates(read.value.tasks, {
            config,
            labelledThisRun: labelledThisRun(ctx.results),
            detail: read.value.detail,
        });
        if (!found.ok) {
            return result("not-evaluable", [found.error], known);
        }
        const { candidates, excluded } = found.value;
        const data = { ...known, candidates: candidates.map(summary), excluded };
        if (candidates.length === 0) {
            return result("wait", waitReasons(excluded), data);
        }
        return compare(candidates, scope.scope, config.selection, ctx.io.selection, data);
    },
    render: renderSelect,
};

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

async function compare(
    candidates: readonly Candidate[],
    machineScope: Scope,
    settings: SelectionConfig,
    selection: SelectionExec,
    data: SelectData,
): Promise<StepResult<SelectData>> {
    const chosen = await choose(candidates, machineScope, settings, selection);
    const comparison =
        chosen.tier === "llm" ? { model: settings.model, effort: settings.effort } : null;
    if (!chosen.ok) {
        return result("not-evaluable", [chosen.error], { ...data, comparison }, chosen.tier);
    }
    const { selected } = chosen;
    const reason = `selected ${selected.source} → ${selected.id} for ${selected.stage}, from ${plural(candidates.length, "candidate")}`;
    return result("advance", [reason], { ...data, selected, comparison }, chosen.tier);
}
