import { describe, expect, it } from "vitest";

import { CONFIG_SCHEMA, parseConfig } from "./config.ts";
import { resolveRunnerSettings } from "./runner-settings.ts";

const base = {
    schema: CONFIG_SCHEMA,
    sources: {
        linear: { enabled: false },
        beads: { enabled: false, directory: "/repo" },
        github: { enabled: false, repos: [] },
    },
    judgement: { model: "m", effort: "low", threshold: 0.9, cap: 1, batch: 1 },
    selection: { model: "m", effort: "low" },
};

function load(runner?: Record<string, number>) {
    const parsed = parseConfig(runner === undefined ? base : { ...base, runner });
    if (!parsed.ok) {
        throw new Error(parsed.error);
    }
    return { config: parsed.value, defaulted: parsed.defaulted };
}

const NO_FLAGS = { grills: undefined, parallel: undefined, interval: undefined };

describe("resolveRunnerSettings", () => {
    it("takes the shipped default of every setting when the file has no runner block", () => {
        expect(resolveRunnerSettings(NO_FLAGS, load())).toEqual({
            grills: { value: 1, source: "default" },
            parallel: { value: 2, source: "default" },
            intervalMinutes: { value: 10, source: "default" },
        });
    });

    it("takes a value the file sets, key by key", () => {
        const settings = resolveRunnerSettings(NO_FLAGS, load({ parallel: 3 }));
        expect(settings).toEqual({
            grills: { value: 1, source: "default" },
            parallel: { value: 3, source: "file" },
            intervalMinutes: { value: 10, source: "default" },
        });
    });

    it("reports a file value equal to the shipped default as the file's", () => {
        const settings = resolveRunnerSettings(
            NO_FLAGS,
            load({ grills: 1, parallel: 2, intervalMinutes: 10 }),
        );
        expect([
            settings.grills.source,
            settings.parallel.source,
            settings.intervalMinutes.source,
        ]).toEqual(["file", "file", "file"]);
    });

    it("lets each flag replace the file and the default", () => {
        const flags = { grills: 0, parallel: 1, interval: 30 };
        const expected = {
            grills: { value: 0, source: "flag" },
            parallel: { value: 1, source: "flag" },
            intervalMinutes: { value: 30, source: "flag" },
        };
        expect(resolveRunnerSettings(flags, load())).toEqual(expected);
        expect(
            resolveRunnerSettings(flags, load({ grills: 5, parallel: 5, intervalMinutes: 5 })),
        ).toEqual(expected);
    });

    it("keeps a flag of 0 for a limit instead of falling through to the file", () => {
        const settings = resolveRunnerSettings({ ...NO_FLAGS, parallel: 0 }, load({ parallel: 4 }));
        expect(settings.parallel).toEqual({ value: 0, source: "flag" });
    });
});
