import {
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
import { resolveStateDir } from "./attempts/state.ts";
import { PRINT_TIMEOUT_MS } from "./claude-print.ts";
import { type ConfigLoad, loadConfig } from "./config.ts";
import { type Exec, execCommand } from "./exec.ts";
import {
    bootstrapLabels,
    renderBootstrapJson,
    renderBootstrapText,
    unconfiguredBootstrap,
} from "./label-contract/bootstrap.ts";
import { claudeJudgement, type JudgementExec } from "./label-triage/judgement.ts";
import { labelTriageStep } from "./label-triage/step.ts";
import { cliTrackers } from "./label-triage/trackers/cli.ts";
import type { TrackerFactory } from "./label-triage/trackers/tracker.ts";
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
import type { WorkspaceManagerFactory } from "./workspace/manager.ts";
import { worktrunkWorkspace } from "./workspace/worktrunk.ts";

const STEPS: readonly Step[] = [
    reconcileStep,
    quotaGateStep,
    labelTriageStep,
    selectStep,
    launchStep,
];

// Spec stage-sessions, "Supplied task": with --task, triage and selection are
// skipped and launch takes the supplied task.
const SUPPLIED_TASK_STEPS: ReadonlySet<string> = new Set(["reconcile", "quota-gate", "launch"]);

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
    stdout: (text: string) => void;
    stderr: (text: string) => void;
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

function dispatch(args: RunArgs, steps: readonly Step[], deps: MainDeps): Promise<number> {
    if (args.bootstrapLabels) {
        return runBootstrap(args, deps);
    }
    if (args.answers.length > 0) {
        return runAnswers(args, steps, deps);
    }
    if (args.discard !== undefined) {
        return runDiscard(args, deps);
    }
    return runPipeline(args, steps, deps);
}

// Design D12: one run at a time reads or writes attempts. `held` runs only once
// the lock is taken, and the lock is released however it ends; a lock another
// live run holds goes to `refused` and nothing else happens.
async function withLock(
    state: string,
    held: () => Promise<number>,
    refused: (error: string) => number,
): Promise<number> {
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
    const startedAt = deps.now();
    const load = loadConfig(deps.env);
    const defaulted = load.ok ? load.defaulted : [];
    const state = resolveStateDir(deps.env);
    const print = (report: RunReport) => {
        deps.stdout(args.json ? renderJson(report) : renderText(report, steps));
        return exitCodeFor(report.outcome);
    };
    return withLock(
        state,
        async () => {
            const run = await runSteps(
                stepsFor(args, steps),
                context(args, startedAt, load, state, deps),
            );
            return print(buildReport(startedAt, run, args, defaulted));
        },
        (error) => {
            const none = { results: [], questions: [], outcome: "not-evaluable" as const };
            return print({ ...buildReport(startedAt, none, args, defaulted), lock: { error } });
        },
    );
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
            state,
        },
    };
}

// The loaded configuration of a mode that runs no step, or null when it failed
// to load: the error then goes to stderr and, with --json, the mode's own
// document holding it (`unconfigured`) to stdout.
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
    const report = await applyAnswers(steps, args.answers, ctx, startedAt);
    deps.stdout(args.json ? renderAnswersJson(report) : renderAnswersText(report));
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
        stdout: (text) => process.stdout.write(`${text}\n`),
        stderr: (text) => process.stderr.write(`${text}\n`),
    });
}
