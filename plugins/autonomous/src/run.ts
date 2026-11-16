import { homedir } from "node:os";

import {
    answeringSteps,
    applyAnswers,
    renderAnswersJson,
    renderAnswersText,
    unconfiguredAnswers,
} from "./answer-mode.ts";
import { parseArgs, type RunArgs, USAGE } from "./args.ts";
import {
    DISCARD_SCHEMA,
    discardAttempt,
    type DiscardReport,
    renderDiscardJson,
    renderDiscardText,
    unconfiguredDiscard,
    withDefaults,
} from "./attempts/discard.ts";
import { launchStep } from "./attempts/launch.ts";
import { acquireLock } from "./attempts/lock.ts";
import { reconcileStep } from "./attempts/reconcile.ts";
import type { AttemptId, TaskRef } from "./attempts/record.ts";
import { resolveStateDir } from "./attempts/state.ts";
import { PRINT_TIMEOUT_MS } from "./claude-print.ts";
import { capacityStep } from "./capacity/step.ts";
import { type ConfigLoad, loadConfig } from "./config.ts";
import { cliContext } from "./context/cli.ts";
import type { ContextReaderFactory } from "./context/types.ts";
import { type Exec, execCommand } from "./exec.ts";
import {
    bootstrapLabels,
    renderBootstrapJson,
    renderBootstrapText,
    unconfiguredBootstrap,
} from "./label-contract/bootstrap.ts";
import { claudeJudgement, type JudgementExec } from "./label-triage/judgement.ts";
import {
    renderTriageQuestionsJson,
    renderTriageQuestionsText,
    runTriageQuestions,
    unconfiguredTriageQuestions,
} from "./label-triage/questions-mode.ts";
import { labelTriageStep } from "./label-triage/step.ts";
import { runLog } from "./logbook/logbook.ts";
import { renderLogJson, renderLogText, unconfiguredLog } from "./logbook/report.ts";
import { cliTrackers } from "./label-triage/trackers/cli.ts";
import type { TrackerFactory } from "./label-triage/trackers/tracker.ts";
import { intervalMs } from "./loop/interval.ts";
import { runLoop } from "./loop/loop.ts";
import { sleep, stopOnSignals, type Wait } from "./loop/signals.ts";
import { stopLoop } from "./loop/stop.ts";
import { waitForNotices } from "./loop/wait-notices.ts";
import { runPersist } from "./persist/persist.ts";
import { renderPersistJson, renderPersistText, unconfiguredPersist } from "./persist/report.ts";
import { ghPullRequests } from "./pull-request/github.ts";
import { runPullRequest } from "./pull-request/mode.ts";
import type { PullRequestsFactory } from "./pull-request/port.ts";
import {
    renderPullRequestJson,
    renderPullRequestText,
    unconfiguredPullRequest,
} from "./pull-request/report.ts";
import { execOpenUsage, type OpenUsageExec } from "./quota-gate/openusage.ts";
import { quotaGateStep } from "./quota-gate/step.ts";
import {
    buildReport,
    exitCodeFor,
    renderJson,
    renderText,
    type RunReport,
    USAGE_EXIT_CODE,
} from "./report.ts";
import { type RunContext, runSteps, type Step } from "./runner.ts";
import { claudeSelection } from "./select/compare.ts";
import { cliWork } from "./select/readers/cli.ts";
import { selectStep } from "./select/step.ts";
import type { SelectionExec, WorkReaderFactory } from "./select/types.ts";
import { aoeSessions } from "./sessions/aoe.ts";
import type { SessionManagerFactory } from "./sessions/manager.ts";
import { NAMING_TIMEOUT_MS } from "./sessions/naming.ts";
import { transitionHandler } from "./transition/answer.ts";
import {
    renderTransitionJson,
    renderTransitionText,
    runTransition,
    unconfiguredTransition,
} from "./transition/mode.ts";
import type { WorkspaceManagerFactory } from "./workspace/manager.ts";
import { worktrunkWorkspace } from "./workspace/worktrunk.ts";

const STEPS: readonly Step[] = [
    reconcileStep,
    capacityStep,
    quotaGateStep,
    labelTriageStep,
    selectStep,
    launchStep,
];

// Spec stage-sessions, "Supplied task": with --task, triage and selection are
// skipped and launch takes the supplied task.
const SUPPLIED_TASK_STEPS: ReadonlySet<string> = new Set([
    "reconcile",
    "capacity",
    "quota-gate",
    "launch",
]);

export interface MainDeps {
    now: () => Date;
    env: Record<string, string | undefined>;
    openUsage: OpenUsageExec;
    trackers: TrackerFactory;
    judgement: JudgementExec;
    chezmoi: Exec;
    work: WorkReaderFactory;
    selection: SelectionExec;
    sessions: SessionManagerFactory;
    workspace: WorkspaceManagerFactory;
    naming: Exec;
    pullRequests: PullRequestsFactory;
    context: ContextReaderFactory;
    openspec: Exec;
    stdout: (text: string) => void;
    stderr: (text: string) => void;
    wait: Wait; // the loop's interval and the polls of --notices and --stop-loop
    stopSignal: () => AbortSignal; // the loop's stop request
    signalLoop: (pid: number) => void; // the one SIGTERM of --stop-loop; throws like process.kill
    steps?: readonly Step[];
}

export async function main(argv: readonly string[], deps: MainDeps): Promise<number> {
    const parsed = parseArgs(argv);
    if (!parsed.ok) {
        deps.stderr(`${parsed.error}\n${USAGE}`);
        return USAGE_EXIT_CODE;
    }

    const steps = deps.steps ?? STEPS;
    try {
        return await dispatch(parsed.args, steps, deps);
    } catch (error) {
        deps.stderr(
            `autonomous run failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        return USAGE_EXIT_CODE;
    }
}

// Without --apply, --loop is one dry iteration: a run with the limits enforced.
const looping = (args: RunArgs) => args.loop && args.apply;

function dispatch(args: RunArgs, steps: readonly Step[], deps: MainDeps): Promise<number> {
    if (args.bootstrapLabels) {
        return runBootstrap(args, deps);
    }
    if (args.triageQuestions) {
        return runTriageQuestionsMode(args, deps);
    }
    if (args.transition !== undefined) {
        return runTransitionMode(args.transition, args, deps);
    }
    if (args.persist !== undefined) {
        return runPersistMode(args.persist, args, deps);
    }
    if (args.pullRequest !== undefined) {
        return runPullRequestMode(args.pullRequest, args, deps);
    }
    if (args.log !== undefined) {
        return runLogMode(args.log, args, deps);
    }
    return dispatchRest(args, steps, deps);
}

function dispatchRest(args: RunArgs, steps: readonly Step[], deps: MainDeps): Promise<number> {
    if (args.answers.length > 0) {
        return runAnswers(args, steps, deps);
    }
    if (args.discard !== undefined) {
        return runDiscard(args, deps);
    }
    if (args.notices !== undefined) {
        return runNoticesMode(args.notices, deps);
    }
    if (args.stopLoop) {
        return runStopLoopMode(deps);
    }
    if (looping(args)) {
        return runLoopMode(args, steps, deps);
    }
    return runPipeline(args, steps, deps);
}

// Design D12: one run at a time reads or writes attempts.
async function withLock<T>(
    state: string,
    held: () => Promise<T>,
    refused: (error: string) => T,
): Promise<T> {
    const lock = await acquireLock(state);
    if (!lock.ok) {
        return refused(lock.error);
    }
    try {
        return await held();
    } finally {
        await lock.release();
    }
}

async function runPipeline(args: RunArgs, steps: readonly Step[], deps: MainDeps): Promise<number> {
    const report = await pipelineReport(args, steps, deps);
    deps.stdout(args.json ? renderJson(report) : renderText(report, steps));
    return exitCodeFor(report.outcome);
}

async function pipelineReport(
    args: RunArgs,
    steps: readonly Step[],
    deps: MainDeps,
): Promise<RunReport> {
    const startedAt = deps.now();
    const load = loadConfig(deps.env);
    const defaulted = load.ok ? load.defaulted : [];
    const state = resolveStateDir(deps.env);
    return withLock(
        state,
        async () => {
            const run = await runSteps(
                stepsFor(args, steps),
                context(args, startedAt, load, state, deps),
            );
            return buildReport(startedAt, run, args, defaulted);
        },
        (error) => {
            const none = { results: [], questions: [], outcome: "not-evaluable" as const };
            return { ...buildReport(startedAt, none, args, defaulted), lock: { error } };
        },
    );
}

// Design D5: every iteration is a run with the limits enforced and no handoff.
function runLoopMode(args: RunArgs, steps: readonly Step[], deps: MainDeps): Promise<number> {
    const iterationArgs = { ...args, noHandoff: true };
    return runLoop({
        state: resolveStateDir(deps.env),
        json: args.json,
        now: deps.now,
        wait: deps.wait,
        stopSignal: deps.stopSignal,
        iterate: () => pipelineReport(iterationArgs, steps, deps),
        render: (report) => renderText(report, steps),
        intervalMs: () => intervalMs(args, loadConfig(deps.env)),
        stderr: deps.stderr,
    });
}

// Design D8: reads only the loop's files, so it needs no configuration and takes no lock.
function runNoticesMode(seen: number, deps: MainDeps): Promise<number> {
    return waitForNotices(seen, {
        state: resolveStateDir(deps.env),
        now: deps.now,
        wait: deps.wait,
        stdout: deps.stdout,
    });
}

// Spec autonomous-loop, "Stopping the loop" (design D7): reads only the loop's files and
// signals its owner, so it needs no configuration and takes no lock.
function runStopLoopMode(deps: MainDeps): Promise<number> {
    return stopLoop({
        state: resolveStateDir(deps.env),
        now: deps.now,
        wait: deps.wait,
        stdout: deps.stdout,
        stderr: deps.stderr,
        signal: deps.signalLoop,
    });
}

function stepsFor(args: RunArgs, steps: readonly Step[]): readonly Step[] {
    return args.task === undefined ? steps : steps.filter((s) => SUPPLIED_TASK_STEPS.has(s.id));
}

function context(
    args: RunArgs,
    now: Date,
    config: ConfigLoad,
    state: string,
    deps: MainDeps,
): RunContext {
    return {
        args,
        now,
        config,
        results: [],
        io: {
            openUsage: deps.openUsage,
            trackers: deps.trackers,
            judgement: deps.judgement,
            chezmoi: deps.chezmoi,
            work: deps.work,
            selection: deps.selection,
            sessions: deps.sessions,
            workspace: deps.workspace,
            naming: deps.naming,
            context: deps.context,
            pullRequests: deps.pullRequests,
            openspec: deps.openspec,
            state,
            home: deps.env.HOME ?? homedir(),
        },
    };
}

// For a mode that runs no step; null once a load failure has been printed.
function modeConfig(
    args: RunArgs,
    deps: MainDeps,
    unconfigured: (path: string, error: string) => string,
): Extract<ConfigLoad, { ok: true }> | null {
    const load = loadConfig(deps.env);
    if (load.ok) {
        return load;
    }
    deps.stderr(load.error);
    if (args.json) {
        deps.stdout(unconfigured(load.path, load.error));
    }
    return null;
}

// Design D9: the bootstrap needs the configuration and the trackers but none of
// the step machinery, and it is not gated by quota.
async function runBootstrap(args: RunArgs, deps: MainDeps): Promise<number> {
    const load = modeConfig(args, deps, (path, error) =>
        renderBootstrapJson(unconfiguredBootstrap(path, error, deps.now())),
    );
    if (load === null) {
        return exitCodeFor("not-evaluable");
    }
    const { config } = load;
    const report = await bootstrapLabels(deps.trackers(config), config, deps.now());
    deps.stdout(args.json ? renderBootstrapJson(report) : renderBootstrapText(report));
    return exitCodeFor(report.outcome);
}

// Design D7: like the bootstrap it needs the configuration and the trackers; it reads no
// attempt and writes nothing, so it takes no lock, and it asks for no quota.
async function runTriageQuestionsMode(args: RunArgs, deps: MainDeps): Promise<number> {
    const startedAt = deps.now();
    const load = modeConfig(args, deps, (path, error) =>
        renderTriageQuestionsJson(unconfiguredTriageQuestions(path, error, startedAt)),
    );
    if (load === null) {
        return exitCodeFor("not-evaluable");
    }
    const { config } = load;
    const report = await runTriageQuestions({ config, trackers: deps.trackers(config) }, startedAt);
    deps.stdout(args.json ? renderTriageQuestionsJson(report) : renderTriageQuestionsText(report));
    return exitCodeFor(report.outcome);
}

// Handoff design D3: answer mode, like the bootstrap, needs the configuration
// and the trackers but runs no step, no quota gate and no judgement.
async function runAnswers(args: RunArgs, steps: readonly Step[], deps: MainDeps): Promise<number> {
    const startedAt = deps.now();
    const load = modeConfig(args, deps, (path, error) =>
        renderAnswersJson(unconfiguredAnswers(path, error, startedAt)),
    );
    if (load === null) {
        return exitCodeFor("not-evaluable");
    }
    const { config } = load;
    const ctx = { config, trackers: deps.trackers(config) };
    const handlers = [...answeringSteps(steps), transitionHandler(resolveStateDir(deps.env))];
    const report = await applyAnswers(handlers, args.answers, ctx, startedAt);
    deps.stdout(args.json ? renderAnswersJson(report) : renderAnswersText(report));
    return exitCodeFor(report.outcome);
}

// Like answer mode, transition mode runs no step and takes no run lock: it and its answer only
// read the attempts, to find a grill-me attempt still waiting for its persistence receipt.
async function runTransitionMode(ref: TaskRef, args: RunArgs, deps: MainDeps): Promise<number> {
    const startedAt = deps.now();
    const load = modeConfig(args, deps, (path, error) =>
        renderTransitionJson(unconfiguredTransition(path, error, startedAt)),
    );
    if (load === null) {
        return exitCodeFor("not-evaluable");
    }
    const { config } = load;
    const transitionDeps = {
        config,
        trackers: deps.trackers(config),
        state: resolveStateDir(deps.env),
    };
    const report = await runTransition(ref, transitionDeps, startedAt);
    deps.stdout(args.json ? renderTransitionJson(report) : renderTransitionText(report));
    return exitCodeFor(report.outcome);
}

// Persist mode runs no step and takes no run lock. It writes a new file beside the
// attempt record, never the record, and a periodic run holding the lock must not fail the
// session of the human waiting on it.
async function runPersistMode(attempt: AttemptId, args: RunArgs, deps: MainDeps): Promise<number> {
    const startedAt = deps.now();
    const load = modeConfig(args, deps, (path, error) =>
        renderPersistJson(unconfiguredPersist(attempt, path, error, startedAt)),
    );
    if (load === null) {
        return exitCodeFor("not-evaluable");
    }
    const { config } = load;
    const persistDeps = {
        config,
        trackers: deps.trackers(config),
        state: resolveStateDir(deps.env),
    };
    const report = await runPersist(attempt, persistDeps, startedAt);
    deps.stdout(args.json ? renderPersistJson(report) : renderPersistText(report));
    return exitCodeFor(report.outcome);
}

// No run lock: the only state it writes is the cover beside the attempt record.
async function runPullRequestMode(
    attempt: AttemptId,
    args: RunArgs,
    deps: MainDeps,
): Promise<number> {
    const startedAt = deps.now();
    const load = modeConfig(args, deps, (path, error) =>
        renderPullRequestJson(unconfiguredPullRequest(attempt, path, error, startedAt)),
    );
    if (load === null) {
        return exitCodeFor("not-evaluable");
    }
    const { config } = load;
    const pullRequestDeps = {
        config,
        state: resolveStateDir(deps.env),
        work: deps.work(config),
        pullRequests: deps.pullRequests,
    };
    const report = await runPullRequest(attempt, args.title, pullRequestDeps, startedAt);
    deps.stdout(args.json ? renderPullRequestJson(report) : renderPullRequestText(report));
    return exitCodeFor(report.outcome);
}

// No run lock: it writes only the entry and its receipt beside the attempt record, never the
// record.
async function runLogMode(attempt: AttemptId, args: RunArgs, deps: MainDeps): Promise<number> {
    const startedAt = deps.now();
    const load = modeConfig(args, deps, (path, error) =>
        renderLogJson(unconfiguredLog(attempt, path, error, startedAt)),
    );
    if (load === null) {
        return exitCodeFor("not-evaluable");
    }
    const { config } = load;
    const logDeps = {
        config,
        state: resolveStateDir(deps.env),
        trackers: deps.trackers(config),
        pullRequests: deps.pullRequests,
        home: deps.env.HOME ?? homedir(),
    };
    const report = await runLog(attempt, logDeps, startedAt);
    deps.stdout(args.json ? renderLogJson(report) : renderLogText(report));
    return exitCodeFor(report.outcome);
}

// Design D11: discard mode, like answer mode, runs no step; unlike it, it
// rewrites an attempt, so it holds the run lock.
async function runDiscard(args: RunArgs, deps: MainDeps): Promise<number> {
    const startedAt = deps.now();
    const load = modeConfig(args, deps, (path, error) =>
        renderDiscardJson(unconfiguredDiscard(path, error, startedAt)),
    );
    if (load === null) {
        return exitCodeFor("not-evaluable");
    }
    const { config, defaulted } = load;
    const state = resolveStateDir(deps.env);
    const print = (done: DiscardReport) => {
        const report = withDefaults(done, defaulted);
        deps.stdout(args.json ? renderDiscardJson(report) : renderDiscardText(report));
        return exitCodeFor(report.outcome);
    };
    return withLock(
        state,
        async () => {
            const discardDeps = {
                state,
                sessions: deps.sessions(config),
                workspace: deps.workspace(config),
                trackers: deps.trackers(config),
                now: deps.now,
                pullRequests: deps.pullRequests,
            };
            return print(await discardAttempt(args, discardDeps, startedAt));
        },
        (error) => print(lockedDiscard(error, startedAt)),
    );
}

function lockedDiscard(error: string, startedAt: Date): DiscardReport {
    return {
        schema: DISCARD_SCHEMA,
        startedAt: startedAt.toISOString(),
        outcome: "not-evaluable",
        attempt: null,
        task: null,
        found: [],
        removed: { session: false, taken: false, workspace: false },
        reasons: [error],
        notes: [],
    };
}

if (import.meta.main) {
    process.exitCode = await main(process.argv.slice(2), {
        now: () => new Date(),
        env: process.env,
        openUsage: execOpenUsage,
        trackers: cliTrackers,
        judgement: claudeJudgement(execCommand("claude", PRINT_TIMEOUT_MS)),
        chezmoi: execCommand("chezmoi"),
        work: cliWork,
        selection: claudeSelection(execCommand("claude", PRINT_TIMEOUT_MS)),
        sessions: aoeSessions,
        workspace: worktrunkWorkspace,
        naming: execCommand("claude", NAMING_TIMEOUT_MS),
        pullRequests: ghPullRequests,
        context: cliContext,
        openspec: execCommand("openspec"),
        stdout: (text) => process.stdout.write(`${text}\n`),
        stderr: (text) => process.stderr.write(`${text}\n`),
        wait: sleep,
        stopSignal: stopOnSignals,
        signalLoop: (pid) => process.kill(pid, "SIGTERM"),
    });
}
