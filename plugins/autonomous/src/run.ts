import { parseArgs, USAGE } from "./args.ts";
import { execOpenUsage, type OpenUsageExec } from "./quota-gate/openusage.ts";
import { quotaGateStep } from "./quota-gate/step.ts";
import { buildReport, exitCodeFor, renderJson, renderText, USAGE_EXIT_CODE } from "./report.ts";
import { runSteps, type Step } from "./runner.ts";

const STEPS: readonly Step[] = [quotaGateStep];

export interface MainDeps {
    now: () => Date;
    openUsage: OpenUsageExec;
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

if (import.meta.main) {
    process.exitCode = await main(process.argv.slice(2), {
        now: () => new Date(),
        openUsage: execOpenUsage,
        stdout: (text) => process.stdout.write(`${text}\n`),
        stderr: (text) => process.stderr.write(`${text}\n`),
    });
}
