// Only the user's confirmation turns a staged screenshot table into this run's
// IBKR read, which `phase1` prefers over the MCP captures (design D4, D12).

import { existsSync, renameSync, rmSync } from "node:fs";

import { stageScreenshots } from "../inputs/ibkr-screenshots.ts";
import { awaitsLogin, ibkrToolWarnings } from "../inputs/ibkr-tools.ts";
import { ibkrConfirmedPath, stagedPath, warningsPath, writePrivate } from "../state.ts";
import { openRun, stop } from "./shared.ts";
import { type Step, type StepOutput, type StepTable, UsageError } from "./types.ts";

function noArgs(name: string, args: readonly string[]): void {
    if (args.length > 0) {
        throw new UsageError(`${name} takes no arguments`);
    }
}

function toolsMarkdown(names: readonly string[], warnings: string[]): string {
    const next = "Continue with the reads `begin` listed, then run `phase1`.";
    if (names.length === 0) {
        return `No IBKR tool names were passed.\n\n${next}`;
    }
    if (awaitsLogin(names)) {
        return `The \`ibkr\` server awaits login, so its tools are not visible yet. Run \`ibkr-tools\` again once it is re-authenticated.\n\n${next}`;
    }
    if (warnings.length === 0) {
        return `All ${new Set(names).size} IBKR tools named are known.\n\n${next}`;
    }
    return `${warnings.map((warning) => `WARNING: ${warning}`).join("\n")}\n\n${next}`;
}

const ibkrTools: Step = (ctx, args) => {
    const opened = openRun(ctx);
    if (!opened.ok) {
        return Promise.resolve(opened.output);
    }
    const { stateDir, run } = opened.scope;
    const warnings = ibkrToolWarnings(args);
    writePrivate(warningsPath(stateDir, run.runId), `${JSON.stringify(warnings)}\n`);
    return Promise.resolve({
        markdown: toolsMarkdown(args, warnings),
        directive: { kind: "done" },
    });
};

const stage: Step = (ctx, args) => {
    noArgs("ibkr-screenshots-stage", args);
    const opened = openRun(ctx);
    if (!opened.ok) {
        return Promise.resolve(opened.output);
    }
    const path = stagedPath(opened.scope.stateDir, opened.scope.run.runId);
    // A table that fails to stage must not leave an older one to confirm.
    rmSync(path, { force: true });
    const result = stageScreenshots(ctx.stdin ?? "");
    if (!result.ok) {
        const output: StepOutput = {
            markdown: `The screenshots table was not staged: ${result.message}`,
            directive: { kind: "ibkr-fallback" },
        };
        return Promise.resolve(output);
    }
    writePrivate(path, `${JSON.stringify(result.read, null, 2)}\n`);
    return Promise.resolve({
        markdown: `${result.markdown}\n\nConfirm this table to continue, or send corrected screenshots.`,
        directive: { kind: "done" },
    });
};

const confirm: Step = (ctx, args) => {
    noArgs("ibkr-screenshots-confirm", args);
    const opened = openRun(ctx);
    if (!opened.ok) {
        return Promise.resolve(opened.output);
    }
    const { stateDir, run } = opened.scope;
    const staged = stagedPath(stateDir, run.runId);
    if (!existsSync(staged)) {
        return Promise.resolve(
            stop("no IBKR table is staged in this run; run `ibkr-screenshots-stage` first"),
        );
    }
    renameSync(staged, ibkrConfirmedPath(stateDir, run.runId));
    return Promise.resolve({
        markdown: "IBKR table confirmed; run `phase1`.",
        directive: { kind: "done" },
    });
};

export const ibkrSteps: StepTable = {
    "ibkr-tools": { step: ibkrTools },
    "ibkr-screenshots-stage": { step: stage, stdin: true },
    "ibkr-screenshots-confirm": { step: confirm },
};
