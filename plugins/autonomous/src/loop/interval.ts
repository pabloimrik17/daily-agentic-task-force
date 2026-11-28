// The wait between two iterations (spec autonomous-loop, "The interval"): the flag,
// then the file, then the shipped default. A configuration that does not load still
// leaves the flag and the shipped default, so the loop keeps its pace.

import { readFileSync } from "node:fs";

import type { RunArgs } from "../args.ts";
import { type ConfigLoad, DEFAULTS_PATH } from "../config.ts";
import { resolveRunnerSettings } from "../runner-settings.ts";
import { number, object } from "../validate.ts";

const MINUTE_MS = 60_000;

function shippedMinutes(): number {
    const root = object(JSON.parse(readFileSync(DEFAULTS_PATH, "utf8")), "$");
    return number(object(root.runner, "$.runner"), "intervalMinutes", "$.runner");
}

export function intervalMs(
    args: Pick<RunArgs, "grills" | "parallel" | "interval">,
    load: ConfigLoad,
): number {
    const minutes = load.ok
        ? resolveRunnerSettings(args, load).intervalMinutes.value
        : (args.interval ?? shippedMinutes());
    return minutes * MINUTE_MS;
}
