import {
    applyAnswers,
    renderAnswersJson,
    renderAnswersText,
    unconfiguredAnswers,
} from "./answer-mode.ts";
import { parseArgs, type RunArgs, USAGE } from "./args.ts";
import { PRINT_TIMEOUT_MS } from "./claude-print.ts";
import { loadConfig } from "./config.ts";
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
import { buildReport, exitCodeFor, renderJson, renderText, USAGE_EXIT_CODE } from "./report.ts";
import { runSteps, type Step } from "./runner.ts";
import { claudeSelection } from "./select/compare.ts";
import { cliWork } from "./select/readers/cli.ts";
import { selectStep } from "./select/step.ts";
import type { SelectionExec, WorkReaderFactory } from "./select/types.ts";

const STEPS: readonly Step[] = [quotaGateStep, labelTriageStep, selectStep];

export interface MainDeps {
    now: () => Date;
    env: Record<string, string | undefined>;
    openUsage: OpenUsageExec;
    trackers: TrackerFactory;
    judgement: JudgementExec;
    chezmoi: Exec;
    work: WorkReaderFactory;
    selection: SelectionExec;
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
        if (parsed.args.bootstrapLabels) {
            return await runBootstrap(parsed.args, deps);
        }
        if (parsed.args.answers.length > 0) {
            return await runAnswers(parsed.args, steps, deps);
        }
        const startedAt = deps.now();
        const run = await runSteps(steps, {
            args: parsed.args,
            now: startedAt,
            config: loadConfig(deps.env),
            results: [],
            io: {
                openUsage: deps.openUsage,
                trackers: deps.trackers,
                judgement: deps.judgement,
                chezmoi: deps.chezmoi,
                work: deps.work,
                selection: deps.selection,
            },
        });
        const report = buildReport(startedAt, run, parsed.args);
        deps.stdout(parsed.args.json ? renderJson(report) : renderText(report, steps));
        return exitCodeFor(report.outcome);
    } catch (error) {
        deps.stderr(
            `autonomous run failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        return USAGE_EXIT_CODE;
    }
}

// Design D9: the bootstrap needs the configuration and the trackers but none of
// the step machinery, and it is not gated by quota.
async function runBootstrap(args: RunArgs, deps: MainDeps): Promise<number> {
    const load = loadConfig(deps.env);
    if (!load.ok) {
        deps.stderr(load.error);
        if (args.json) {
            deps.stdout(
                renderBootstrapJson(unconfiguredBootstrap(load.path, load.error, deps.now())),
            );
        }
        return exitCodeFor("not-evaluable");
    }
    const report = await bootstrapLabels(deps.trackers(load.config), load.config, deps.now());
    deps.stdout(args.json ? renderBootstrapJson(report) : renderBootstrapText(report));
    return exitCodeFor(report.outcome);
}

// Handoff design D3: answer mode, like the bootstrap, needs the configuration
// and the trackers but runs no step, no quota gate and no judgement.
async function runAnswers(args: RunArgs, steps: readonly Step[], deps: MainDeps): Promise<number> {
    const startedAt = deps.now();
    const load = loadConfig(deps.env);
    if (!load.ok) {
        deps.stderr(load.error);
        if (args.json) {
            deps.stdout(renderAnswersJson(unconfiguredAnswers(load.path, load.error, startedAt)));
        }
        return exitCodeFor("not-evaluable");
    }
    const ctx = { config: load.config, trackers: deps.trackers(load.config) };
    const report = await applyAnswers(steps, args.answers, ctx, startedAt);
    deps.stdout(args.json ? renderAnswersJson(report) : renderAnswersText(report));
    return exitCodeFor(report.outcome);
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
        stdout: (text) => process.stdout.write(`${text}\n`),
        stderr: (text) => process.stderr.write(`${text}\n`),
    });
}
