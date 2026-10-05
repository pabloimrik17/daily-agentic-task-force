// Plumbing every engine step shares (design D6, D12): the open run with its
// configuration, this run's captures, the live sheet read and the `stop`
// output. Nothing here decides anything about the data.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { loadConfig } from "../config.ts";
import type { ActiveRun, StonksConfig, TrackingSheet } from "../domain.ts";
import { readSheetValues } from "../inputs/sheet-gws.ts";
import { parseSheet } from "../inputs/sheet.ts";
import { rawDir, readActiveRun, resolveStateDir } from "../state.ts";
import type { StepContext, StepOutput } from "./types.ts";

export interface RunScope {
    stateDir: string;
    run: ActiveRun;
    config: StonksConfig;
}

export type Scoped = { ok: true; scope: RunScope } | { ok: false; output: StepOutput };

/** The `stop` directive with its line for the user. */
export function stop(reason: string): StepOutput {
    return { markdown: `Stopped: ${reason}`, directive: { kind: "stop", reason } };
}

/** The open run and the configuration; without either, the `stop` to print. */
export function openRun(ctx: StepContext): Scoped {
    const stateDir = resolveStateDir(ctx.env);
    const run = readActiveRun({ stateDir, now: ctx.now() });
    if (run === null) {
        return {
            ok: false,
            output: stop("no run is open, or it has expired; run `begin` first"),
        };
    }
    const loaded = loadConfig(ctx.env);
    if (!loaded.ok) {
        return { ok: false, output: stop(loaded.error) };
    }
    return { ok: true, scope: { stateDir, run, config: loaded.config } };
}

export interface Capture {
    path: string;
    text: string;
}

/**
 * The newest capture of one kind in this run: the file `raw/<seq>-<kind>.json`
 * with the greatest `seq`, or null when the run has none. The capture hook
 * writes `seq` as the zero-padded epoch milliseconds, so names sort by time.
 */
export function latestCapture(scope: RunScope, kind: string): Capture | null {
    const dir = rawDir(scope.stateDir, scope.run.runId);
    const suffix = `-${kind}.json`;
    let names: string[];
    try {
        names = readdirSync(dir);
    } catch {
        return null;
    }
    const match = names
        .filter((name) => name.endsWith(suffix))
        .sort()
        .at(-1);
    if (match === undefined) {
        return null;
    }
    const path = join(dir, match);
    return { path, text: readFileSync(path, "utf8") };
}

/** A capture's text as JSON; null when it is not JSON. */
export function captureJson(capture: Capture): unknown {
    try {
        return JSON.parse(capture.text);
    } catch {
        return null;
    }
}

export type SheetResult = { ok: true; sheet: TrackingSheet } | { ok: false; reason: string };

/** Reads the tracking sheet live through gws and parses it strictly. */
export async function readSheet(ctx: StepContext, scope: RunScope): Promise<SheetResult> {
    const read = await readSheetValues(scope.config.trackingSheet, ctx.sheetRunner);
    if (!read.ok) {
        return { ok: false, reason: `tracking sheet: ${read.error.message}` };
    }
    const parsed = parseSheet(read.values);
    return parsed.ok ? { ok: true, sheet: parsed.sheet } : { ok: false, reason: parsed.error };
}
