// The step machine's shared types (design D12). They live apart from `cli.ts`
// so that the step modules import nothing that imports them back.

import type { Directive } from "../domain.ts";
import type { Runner } from "../inputs/sheet-gws.ts";

export interface StepContext {
    env: Record<string, string | undefined>;
    /** Standard input, read only for the steps that declare it. */
    stdin?: string;
    now: () => Date;
    /** Runs `gws` for the sheet read; tests inject one. */
    sheetRunner?: Runner;
}

export interface StepOutput {
    markdown: string;
    directive: Directive;
}

export type Step = (ctx: StepContext, args: readonly string[]) => Promise<StepOutput>;

export interface Io {
    stdout: (text: string) => void;
    stderr: (text: string) => void;
}

/** A step throws this for bad arguments; the CLI prints it with the usage and exits 1. */
export class UsageError extends Error {}

/** A module's steps by name; `stdin` marks the ones that read standard input. */
export type StepTable = Record<string, { step: Step; stdin?: boolean }>;
