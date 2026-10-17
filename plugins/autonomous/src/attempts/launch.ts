// The launch step (spec stage-sessions, "The launch step", "Launch sequence";
// design D9): takes the selected unit, or the task supplied by `--task`, reads
// the task again through the select step's exclusions, checks the
// preconditions in D9's order and, with `--apply`, prepares the workspace and
// launches one attempt. The sequence is a list of small steps, each writing the
// record before the next one depends on it, so a crash at any point leaves a
// record that `reconcile` resolves.

import { mkdir, writeFile } from "node:fs/promises";

import type { AutonomousConfig, Source } from "../config.ts";
import type { Tracker } from "../label-triage/trackers/tracker.ts";
import type { Result } from "../result.ts";
import type { RunContext, Step, StepResult } from "../runner.ts";
import { labelledThisRun, selectCandidates } from "../select/candidates.ts";
import type { Excluded, SelectData, WorkReader, WorkTask } from "../select/types.ts";
import type { SessionManager } from "../sessions/manager.ts";
import { type Naming, nameSession } from "../sessions/naming.ts";
import { STAGES } from "../stages/registry.ts";
import type { Stage } from "../stages/stage.ts";
import { branchFor, groupFor, inferRepository, listRepositories } from "../workspace/infer.ts";
import { exclusionName, renderLaunch } from "./launch-render.ts";
import {
    ATTEMPT_SCHEMA,
    type AttemptRecord,
    type AttemptState,
    attemptId,
    OPEN_STATES,
} from "./record.ts";
import {
    attemptDir,
    listRecords,
    nextAttempt,
    promptPath,
    resultPath,
    writeRecord,
} from "./state.ts";
import { addTaken, TAKEN } from "./taken.ts";

const LAUNCH = "launch";

export interface LaunchData {
    task: { source: Source; id: string; title: string } | null;
    stage: string | null;
    input: "selected" | "supplied" | null; // where the unit came from
    excluded: Excluded | null; // the select exclusion that stopped it, when one did
    repository: { path: string; inferredFrom: string } | null;
    branch: string | null;
    group: string | null;
    title: { value: string; source: "llm" | "fallback"; error: string | null } | null;
    workspace: { path: string; created: boolean } | null; // --apply only
    attempt: { id: string; state: AttemptState; session: string | null } | null; // --apply only; the record's last state
}

const EMPTY: LaunchData = {
    task: null,
    stage: null,
    input: null,
    excluded: null,
    repository: null,
    branch: null,
    group: null,
    title: null,
    workspace: null,
    attempt: null,
};

// A check or an action that stopped the launch: a precondition is `wait`, a
// failed read or write is `not-evaluable`.
type Gate<T> =
    | { ok: true; value: T }
    | { ok: false; outcome: "wait" | "not-evaluable"; reason: string };

type Stop = Extract<Gate<never>, { ok: false }>;

const wait = (reason: string): Stop => ({ ok: false, outcome: "wait", reason });

const broken = (reason: string): Stop => ({ ok: false, outcome: "not-evaluable", reason });

const pass = <T>(value: T): Gate<T> => ({ ok: true, value });

function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

interface Unit {
    source: Source;
    id: string;
    input: "selected" | "supplied";
}

// What the preconditions settled, and what a launch needs from them.
interface Plan {
    task: WorkTask; // read again and detailed
    stage: Stage;
    records: AttemptRecord[];
    repository: { path: string; inferredFrom: string };
    branch: string;
    group: string;
    naming: Naming;
    sessions: SessionManager;
}

function tierOf(data: LaunchData): StepResult["tier"] {
    return data.title?.source === "llm" ? "llm" : "code";
}

function result(
    outcome: StepResult["outcome"],
    reasons: string[],
    data: LaunchData,
): StepResult<LaunchData> {
    return { step: LAUNCH, tier: tierOf(data), outcome, reasons, data };
}

function stopped(stop: Stop, data: LaunchData): StepResult<LaunchData> {
    return result(stop.outcome, [stop.reason], data);
}

export const launchStep: Step<LaunchData> = {
    id: LAUNCH,
    async run(ctx) {
        if (!ctx.config.ok) {
            return result("not-evaluable", [ctx.config.error], EMPTY);
        }
        const unit = unitOf(ctx);
        if (unit === null) {
            return result("wait", ["nothing selected"], EMPTY);
        }
        const data: LaunchData = { ...EMPTY, input: unit.input };
        const planned = await plan(ctx, ctx.config.config, unit, data);
        if (!planned.ok) {
            return stopped(planned, data);
        }
        if (!ctx.args.apply) {
            return result("advance", dryRun(planned.value), data);
        }
        const launched = await launch(ctx, ctx.config.config, planned.value, data);
        return launched.ok ? result("advance", [launched.value], data) : stopped(launched, data);
    },
    render: renderLaunch,
};

// `--task` wins: with it, label-triage and select do not run.
function unitOf(ctx: RunContext): Unit | null {
    if (ctx.args.task !== undefined) {
        return { ...ctx.args.task, input: "supplied" };
    }
    const select = ctx.results.find((r) => r.step === "select");
    const selected = (select?.data as SelectData | undefined)?.selected ?? null;
    return selected === null
        ? null
        : { source: selected.source, id: selected.id, input: "selected" };
}

async function plan(
    ctx: RunContext,
    config: AutonomousConfig,
    unit: Unit,
    data: LaunchData,
): Promise<Gate<Plan>> {
    const read = await readUnit(ctx, config, unit, data);
    if (!read.ok) {
        return read;
    }
    const checked = await preconditions(ctx.io.state, config.workspace.root, read.value);
    if (!checked.ok) {
        return checked;
    }
    data.repository = checked.value.repository;
    const sessions = ctx.io.sessions(config);
    const groups = await sessions.listGroups();
    if (!groups.ok) {
        return broken(groups.error);
    }
    const { task, stage, records, repository } = checked.value;
    const naming = await nameSession(ctx.io.naming, config.naming, task, stage);
    const branch = branchOf(records, task);
    const group = groupFor(repository.path, groups.value);
    Object.assign(data, { branch, group, title: titleOf(naming) });
    return pass({ ...checked.value, branch, group, naming, sessions });
}

// One branch per task: the first attempt derives it from the title, every
// later attempt, at any stage, reuses the latest record's.
function branchOf(records: readonly AttemptRecord[], task: WorkTask): string {
    const latest = records
        .filter((record) => record.task.source === task.source && record.task.id === task.id)
        .reduce<AttemptRecord | null>(
            (best, record) => (best === null || record.attempt > best.attempt ? record : best),
            null,
        );
    return latest?.workspace.branch ?? branchFor(task);
}

function titleOf(naming: Naming): LaunchData["title"] {
    return { value: naming.title, source: naming.source, error: naming.error };
}

// The task read again from its tracker and passed through select's exclusions,
// so a task taken since selection, or a supplied task select would exclude,
// waits with the exclusion's name.
async function readUnit(
    ctx: RunContext,
    config: AutonomousConfig,
    unit: Unit,
    data: LaunchData,
): Promise<Gate<{ task: WorkTask; stage: string }>> {
    const read = await readTask(ctx.io.work(config), unit);
    if (!read.ok) {
        return read;
    }
    const { task, reader } = read.value;
    data.task = { source: task.source, id: task.id, title: task.title };
    const checked = await selectCandidates([task], {
        config,
        labelledThisRun: labelledThisRun(ctx.results),
        detail: (listed) => reader.detail(listed),
        stage: ctx.args.stage,
    });
    if (!checked.ok) {
        return broken(`${unit.source}: ${checked.error}`);
    }
    const [excluded] = checked.value.excluded;
    if (excluded !== undefined) {
        data.excluded = excluded;
        return wait(`${unit.source}:${unit.id} is excluded: ${exclusionName(excluded)}`);
    }
    const candidate = checked.value.candidates[0]!; // one task in, not excluded
    data.stage = ctx.args.stage ?? candidate.stage;
    return pass({ task: candidate.task, stage: data.stage });
}

// The open task of the unit's source with the unit's id; a source with no
// reader (not enabled) has no open task.
async function readTask(
    readers: readonly WorkReader[],
    unit: Unit,
): Promise<Gate<{ task: WorkTask; reader: WorkReader }>> {
    const reader = readers.find((candidate) => candidate.source === unit.source);
    if (reader === undefined) {
        return wait(`${unit.source}:${unit.id} is not an open task`);
    }
    const listed = await reader.list();
    if (!listed.ok) {
        return broken(`${unit.source}: ${listed.error}`);
    }
    const task = listed.value.find((candidate) => candidate.id === unit.id);
    return task === undefined
        ? wait(`${unit.source}:${unit.id} is not an open task`)
        : pass({ task, reader });
}

// Design D9's order: the stage is registered, the task carries no `taken`, no
// attempt of the task is open, and a repository is inferred.
async function preconditions(
    state: string,
    root: string,
    read: { task: WorkTask; stage: string },
): Promise<Gate<Pick<Plan, "task" | "stage" | "records" | "repository">>> {
    const { task } = read;
    const stage = STAGES.get(read.stage);
    if (stage === undefined) {
        return wait(`stage ${read.stage} has no implementation`);
    }
    // Already an exclusion of readUnit; kept so the order of D9 reads here.
    if (task.labels.includes(TAKEN)) {
        return wait(`${task.source}:${task.id} carries taken`);
    }
    const records = await readRecords(state);
    if (!records.ok) {
        return records;
    }
    const open = openAttempt(records.value, task);
    if (open !== null) {
        return wait(open);
    }
    const repository = await inferFor(root, task);
    return repository.ok
        ? pass({ task, stage, records: records.value, repository: repository.value })
        : repository;
}

async function readRecords(state: string): Promise<Gate<AttemptRecord[]>> {
    try {
        return pass(await listRecords(state));
    } catch (error) {
        return broken(messageOf(error));
    }
}

// The first attempt of the task, at any stage, that still holds it.
function openAttempt(records: readonly AttemptRecord[], task: WorkTask): string | null {
    const open = records.find(
        (record) =>
            record.task.source === task.source && record.task.id === task.id && holdsTask(record),
    );
    if (open === undefined) {
        return null;
    }
    const state = open.cleanup === null ? open.state : `${open.state} with a pending cleanup`;
    return `attempt ${open.id} is ${state}`;
}

// Open, or completed with a cleanup still owed; a stale cleanup on a discarded
// or aborted record (legacy data) never blocks a launch.
const holdsTask = (record: AttemptRecord): boolean =>
    OPEN_STATES.includes(record.state) || (record.state === "completed" && record.cleanup !== null);

async function inferFor(
    root: string,
    task: WorkTask,
): Promise<Gate<{ path: string; inferredFrom: string }>> {
    let repositories: string[];
    try {
        repositories = await listRepositories(root);
    } catch (error) {
        return broken(messageOf(error));
    }
    const inferred = inferRepository(task, repositories);
    return inferred.ok
        ? pass({ path: inferred.repository, inferredFrom: inferred.inferredFrom })
        : wait(inferred.reason);
}

function dryRun({ task, stage, repository, branch, naming }: Plan): string[] {
    return [
        `would launch ${stage.id} for ${task.source}:${task.id} in ${repository.path} on ${branch} as "${naming.title}"`,
        naming.source === "llm"
            ? "name inferred by the LLM"
            : `name from the fallback: ${naming.error}`,
    ];
}

// The launch sequence's shared state: `record` is the record each action
// builds on, `written` the last one on disk, null until the pending record is.
interface Launching {
    plan: Plan;
    state: string;
    dir: string;
    at: string;
    tracker: Tracker;
    binary: string | null;
    record: AttemptRecord;
    written: AttemptRecord | null;
}

type Action = (launching: Launching) => Promise<Result<void>>;

const SEQUENCE: [name: string, action: Action][] = [
    ["write the pending record", (l) => save(l, l.record)],
    ["add taken", takeTask],
    ["write the prompt", writePrompt],
    ["create the session", createSession],
    ["start the session", startSession],
];

async function launch(
    ctx: RunContext,
    config: AutonomousConfig,
    plan: Plan,
    data: LaunchData,
): Promise<Gate<string>> {
    const prepared = await ctx.io.workspace(config).prepare(plan.repository.path, plan.branch);
    if (!prepared.ok) {
        return broken(prepared.error);
    }
    data.workspace = prepared.value;
    const launching = begin(ctx, config, plan, prepared.value.path);
    for (const [name, action] of SEQUENCE) {
        const done = await perform(name, action, launching);
        data.attempt = summary(launching.written);
        if (!done.ok) {
            return broken(done.error);
        }
    }
    return pass(
        `launched ${launching.record.id} as "${plan.naming.title}" in ${prepared.value.path}`,
    );
}

// A thrown write becomes a failure naming the action.
async function perform(name: string, action: Action, launching: Launching): Promise<Result<void>> {
    try {
        return await action(launching);
    } catch (error) {
        return { ok: false, error: `${name}: ${messageOf(error)}` };
    }
}

function summary(record: AttemptRecord | null): LaunchData["attempt"] {
    return record === null
        ? null
        : { id: record.id, state: record.state, session: record.session?.id ?? null };
}

function begin(ctx: RunContext, config: AutonomousConfig, plan: Plan, path: string): Launching {
    const { task, stage, records, repository, branch, group, naming } = plan;
    const n = nextAttempt(records, task, stage.id);
    const id = attemptId(task, stage.id, n);
    const at = ctx.now.toISOString();
    const record: AttemptRecord = {
        schema: ATTEMPT_SCHEMA,
        id,
        task: { source: task.source, id: task.id, title: task.title },
        stage: stage.id,
        attempt: n,
        state: "pending",
        history: [{ state: "pending", at }],
        taken: { added: null, removed: null },
        workspace: {
            manager: "worktrunk",
            repository: repository.path,
            inferredFrom: repository.inferredFrom,
            branch,
            path,
        },
        session: {
            manager: "aoe",
            profile: config.sessions.profile,
            id: null,
            group,
            title: naming.title,
            titleSource: naming.source,
            tool: config.sessions.tool,
            agentSessionId: null,
        },
        observed: null,
        cleanup: null,
        retained: null,
    };
    const tracker = ctx.io.trackers(config)[task.source];
    return {
        plan,
        state: ctx.io.state,
        dir: attemptDir(ctx.io.state, id),
        at,
        tracker,
        binary: config.sessions.binary,
        record,
        written: null,
    };
}

async function save(launching: Launching, record: AttemptRecord): Promise<Result<void>> {
    await writeRecord(launching.state, record);
    launching.record = record;
    launching.written = record;
    return { ok: true, value: undefined };
}

function moved(record: AttemptRecord, state: AttemptState, at: string): AttemptRecord {
    return { ...record, state, history: [...record.history, { state, at }] };
}

async function takeTask(launching: Launching): Promise<Result<void>> {
    const { record, tracker, at } = launching;
    const taken = await addTaken(tracker, record.task.id);
    if (!taken.ok) {
        return { ok: false, error: `taken: ${taken.error}` };
    }
    return save(launching, { ...record, taken: { ...record.taken, added: at } });
}

// The prompt is text beside the record, never in the workspace.
async function writePrompt(launching: Launching): Promise<Result<void>> {
    const { plan, dir, record } = launching;
    await mkdir(dir, { recursive: true });
    const prompt = plan.stage.prompt({
        attempt: record,
        task: plan.task,
        resultPath: resultPath(dir),
    });
    await writeFile(promptPath(dir), prompt);
    return { ok: true, value: undefined };
}

async function createSession(launching: Launching): Promise<Result<void>> {
    const { plan, dir, record, at, binary } = launching;
    const session = record.session!; // set by begin()
    const created = await plan.sessions.create({
        path: record.workspace.path,
        title: session.title,
        group: session.group,
        tool: session.tool,
        binary,
        args: plan.stage.agentArgs(session.tool),
        instruction: `Read ${promptPath(dir)} and follow it.`,
    });
    if (!created.ok) {
        return created;
    }
    return save(launching, {
        ...moved(record, "created", at),
        session: { ...session, id: created.value.id },
    });
}

async function startSession(launching: Launching): Promise<Result<void>> {
    const { plan, record, at } = launching;
    const started = await plan.sessions.start(record.session!.id!);
    return started.ok ? save(launching, moved(record, "started", at)) : started;
}
