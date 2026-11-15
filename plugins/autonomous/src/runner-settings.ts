// The limits and the interval of the loop, each with where it came from
// (design D3): a flag of the loop wins, then a key the user's file sets, then
// the shipped default.

import type { RunArgs } from "./args.ts";
import type { AutonomousConfig, RunnerConfig } from "./config.ts";

export type SettingSource = "flag" | "file" | "default";

export interface Setting {
    value: number;
    source: SettingSource;
}

export interface RunnerSettings {
    grills: Setting; // limit of grill slots
    parallel: Setting; // limit of work slots
    intervalMinutes: Setting;
}

// The flag of each setting; `intervalMinutes` is the key in the file and `--interval` the flag.
const FLAGS = { grills: "grills", parallel: "parallel", intervalMinutes: "interval" } as const;

function setting(
    key: keyof RunnerConfig,
    args: Pick<RunArgs, "grills" | "parallel" | "interval">,
    load: { config: AutonomousConfig; defaulted: string[] },
): Setting {
    const flag = args[FLAGS[key]];
    if (flag !== undefined) {
        return { value: flag, source: "flag" };
    }
    const source = load.defaulted.includes(`runner.${key}`) ? "default" : "file";
    return { value: load.config.runner[key], source };
}

export function resolveRunnerSettings(
    args: Pick<RunArgs, "grills" | "parallel" | "interval">,
    load: { config: AutonomousConfig; defaulted: string[] },
): RunnerSettings {
    return {
        grills: setting("grills", args, load),
        parallel: setting("parallel", args, load),
        intervalMinutes: setting("intervalMinutes", args, load),
    };
}
