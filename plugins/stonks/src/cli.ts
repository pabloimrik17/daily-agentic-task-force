// Step machine entry (design D12). Each step prints markdown, a blank line and
// a last `directive: <JSON>` line the command follows; exit 1 on usage or
// runner error.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { parseArgs, USAGE } from "./args.ts";
import { loadConfig } from "./config.ts";
import type { RunMode, StonksConfig } from "./domain.ts";
import { beginRun, endRun, resolveStateDir } from "./state.ts";
import { browserSteps } from "./steps/browser.ts";
import { ibkrSteps } from "./steps/ibkr.ts";
import { phase1Steps } from "./steps/phase1.ts";
import { watchlistSteps } from "./steps/watchlist.ts";

import type { Io, Step, StepContext, StepOutput, StepTable } from "./steps/types.ts";
import { UsageError } from "./steps/types.ts";

export type { Io, StepContext } from "./steps/types.ts";

/** What `begin` asks for: phase 1's reads, or, in `--only watchlist`, phase 2's. */
function readsOf(mode: RunMode, config: StonksConfig): string[] {
    if (mode === "watchlist") {
        return [
            "Reads to perform:",
            "- tracking sheet: the engine reads it through gws in `watchlist-plan`; nothing to do",
            `- watchlist: its collector, at ${config.watchlist.url}`,
            "",
            "When the watchlist is read, run `watchlist-plan`.",
        ];
    }
    const lines = [
        "Reads to perform:",
        "- IBKR positions: `mcp__ibkr__get_account_positions`",
        "- IBKR orders: `mcp__ibkr__get_account_orders`",
        "- tracking sheet: the engine reads it through gws in `phase1`; nothing to do",
        `- SWS portfolio: its collector, at ${config.swsPortfolio.url}`,
        `- Cartera Viva: its collector, at ${config.carteraViva.url}`,
        "",
        "Also run `ibkr-tools` with the name of every `mcp__ibkr__*` tool in this session. When every read is done, run `phase1`.",
    ];
    if (mode === "full") {
        lines.push(
            "",
            `The watchlist (${config.watchlist.url}) is read in phase 2, just before \`watchlist-plan\`, never before the gate.`,
        );
    }
    return lines;
}

const begin: Step = (ctx, args) => {
    const parsed = parseArgs(args);
    if (!parsed.ok) {
        throw new UsageError(parsed.error);
    }
    const loaded = loadConfig(ctx.env);
    if (!loaded.ok) {
        return Promise.resolve({
            markdown: `Cannot start: ${loaded.error}`,
            directive: { kind: "stop", reason: loaded.error },
        });
    }
    const mode: RunMode = parsed.args.only ?? "full";
    const { runId } = beginRun({
        stateDir: resolveStateDir(ctx.env),
        mode,
        now: ctx.now(),
    });
    const markdown = [
        `Run \`${runId}\` opened, mode \`${mode}\`.`,
        "",
        ...readsOf(mode, loaded.config),
    ].join("\n");
    return Promise.resolve({ markdown, directive: { kind: "done" } });
};

const end: Step = (ctx) => {
    endRun(resolveStateDir(ctx.env));
    return Promise.resolve({ markdown: "Run closed.", directive: { kind: "done" } });
};

const entries = (table: StepTable): [string, StepTable[string]][] => Object.entries(table);

const table = new Map<string, StepTable[string]>([
    ["begin", { step: begin }],
    ["end", { step: end }],
    ...entries(ibkrSteps),
    ...entries(browserSteps),
    ...entries(phase1Steps),
    ...entries(watchlistSteps),
]);

/** The steps the command can call. */
const steps = new Map<string, Step>(
    [...table].map(([name, entry]): [string, Step] => [name, entry.step]),
);

/** Steps that read the process's standard input. */
export const stdinSteps = new Set<string>(
    [...table].filter(([, entry]) => entry.stdin === true).map(([name]) => name),
);

function usage(): string {
    return `${USAGE}\nSteps: ${[...steps.keys()].join(", ")}`;
}

export async function runCli(argv: readonly string[], ctx: StepContext, io: Io): Promise<number> {
    const [name, ...args] = argv;
    const step = name === undefined ? undefined : steps.get(name);
    if (step === undefined) {
        io.stderr(`${name === undefined ? "missing step" : `unknown step: ${name}`}\n${usage()}\n`);
        return 1;
    }
    let output: StepOutput;
    try {
        output = await step(ctx, args);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        io.stderr(error instanceof UsageError ? `${message}\n${USAGE}\n` : `${message}\n`);
        return 1;
    }
    io.stdout(`${output.markdown.trimEnd()}\n\ndirective: ${JSON.stringify(output.directive)}\n`);
    return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const argv = process.argv.slice(2);
    const ctx: StepContext = { env: process.env, now: () => new Date() };
    if (argv[0] !== undefined && stdinSteps.has(argv[0])) {
        ctx.stdin = readFileSync(0, "utf8");
    }
    process.exitCode = await runCli(argv, ctx, {
        stdout: (text) => process.stdout.write(text),
        stderr: (text) => process.stderr.write(text),
    });
}
