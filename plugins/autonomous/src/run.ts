import { parseArgs, type RunArgs, USAGE } from "./args.ts";
import { loadConfig } from "./config.ts";
import {
    bootstrapLabels,
    renderBootstrapJson,
    renderBootstrapText,
} from "./label-contract/bootstrap.ts";
import { cliTrackers } from "./label-triage/trackers/cli.ts";
import type { TrackerFactory } from "./label-triage/trackers/tracker.ts";
import { execOpenUsage, type OpenUsageExec } from "./quota-gate/openusage.ts";
import { quotaGateStep } from "./quota-gate/step.ts";
import { buildReport, exitCodeFor, renderJson, renderText, USAGE_EXIT_CODE } from "./report.ts";
import { runSteps, type Step } from "./runner.ts";

const STEPS: readonly Step[] = [quotaGateStep];

export interface MainDeps {
    now: () => Date;
    env: Record<string, string | undefined>;
    openUsage: OpenUsageExec;
    trackers: TrackerFactory;
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
        const startedAt = deps.now();
        const run = await runSteps(steps, {
            args: parsed.args,
            now: startedAt,
            io: { openUsage: deps.openUsage },
        });
        const report = buildReport(startedAt, run);
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
        return exitCodeFor("not-evaluable");
    }
    const report = await bootstrapLabels(deps.trackers(load.config), load.config, deps.now());
    deps.stdout(args.json ? renderBootstrapJson(report) : renderBootstrapText(report));
    return exitCodeFor(report.outcome);
}

if (import.meta.main) {
    process.exitCode = await main(process.argv.slice(2), {
        now: () => new Date(),
        env: process.env,
        openUsage: execOpenUsage,
        trackers: cliTrackers,
        stdout: (text) => process.stdout.write(`${text}\n`),
        stderr: (text) => process.stderr.write(`${text}\n`),
    });
}
