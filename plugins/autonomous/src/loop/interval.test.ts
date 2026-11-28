import { describe, expect, it } from "vitest";

import type { ConfigLoad } from "../config.ts";
import { config } from "../label-triage/test-fixtures.ts";
import { intervalMs } from "./interval.ts";

const MINUTE = 60_000;

const args = (interval: number | undefined) => ({
    grills: undefined,
    parallel: undefined,
    interval,
});

function loaded(intervalMinutes: number, defaulted: string[] = []): ConfigLoad {
    const base = config();
    return {
        ok: true,
        path: "/c.json",
        config: { ...base, runner: { ...base.runner, intervalMinutes } },
        defaulted,
    };
}

const broken: ConfigLoad = { ok: false, path: "/c.json", error: "does not parse" };

describe("intervalMs", () => {
    it("takes --interval over the file", () => {
        expect(intervalMs(args(30), loaded(5))).toBe(30 * MINUTE);
    });

    it("takes the file without the flag", () => {
        expect(intervalMs(args(undefined), loaded(5))).toBe(5 * MINUTE);
    });

    it("takes the shipped default the file left out", () => {
        const load = loaded(10, ["runner.intervalMinutes"]);
        expect(intervalMs(args(undefined), load)).toBe(10 * MINUTE);
    });

    it("keeps the flag when the configuration does not load", () => {
        expect(intervalMs(args(30), broken)).toBe(30 * MINUTE);
    });

    it("falls back to the shipped 10 minutes when the configuration does not load", () => {
        expect(intervalMs(args(undefined), broken)).toBe(10 * MINUTE);
    });
});
