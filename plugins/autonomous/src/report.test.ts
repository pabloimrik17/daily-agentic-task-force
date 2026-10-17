import { describe, expect, it } from "vitest";

import { buildReport, renderJson, renderText } from "./report.ts";
import type { RunResult } from "./runner.ts";

const STARTED = new Date("2026-10-17T09:00:00Z");
const ARGS = { apply: false, noHandoff: false };
const RUN: RunResult = {
    results: [{ step: "quota-gate", tier: "code", outcome: "advance", reasons: [], data: null }],
    outcome: "advance",
    questions: [],
};

describe("run report configuration defaults", () => {
    it("prints a defaults line in the text header and carries the keys in the JSON", () => {
        const report = buildReport(STARTED, RUN, ARGS, ["sessions.tool", "naming.model"]);
        const header = renderText(report, []).split("\n\n")[0]!.split("\n");

        expect(header).toEqual([
            "autonomous run — started 2026-10-17T09:00:00.000Z",
            "outcome: advance",
            "defaults: sessions.tool, naming.model",
        ]);
        expect(JSON.parse(renderJson(report))).toMatchObject({
            config: { defaulted: ["sessions.tool", "naming.model"] },
        });
    });

    it("prints neither the line nor a config key when nothing took a default", () => {
        const report = buildReport(STARTED, RUN, ARGS, []);

        expect(renderText(report, [])).not.toContain("defaults:");
        expect(JSON.parse(renderJson(report))).not.toHaveProperty("config");
    });

    it("defaults to no defaulted keys when the argument is left out", () => {
        const report = buildReport(STARTED, RUN, ARGS);

        expect(report).not.toHaveProperty("config");
        expect(renderText(report, [])).not.toContain("defaults:");
    });
});

describe("run report lock", () => {
    const LOCKED: RunResult = { results: [], outcome: "not-evaluable", questions: [] };
    const error = "another run holds /state/run.lock (pid 1234, started 2026-10-17T08:59:00.000Z)";

    it("prints the lock line after the header and carries the error in the JSON", () => {
        const report = { ...buildReport(STARTED, LOCKED, ARGS), lock: { error } };

        expect(renderText(report, [])).toBe(
            [
                "autonomous run — started 2026-10-17T09:00:00.000Z\noutcome: not-evaluable",
                `lock: ${error}`,
            ].join("\n\n"),
        );
        expect(JSON.parse(renderJson(report))).toEqual({
            schema: "autonomous.run.v1",
            startedAt: "2026-10-17T09:00:00.000Z",
            steps: [],
            outcome: "not-evaluable",
            lock: { error },
        });
    });

    it("prints no lock line when the lock was taken", () => {
        expect(renderText(buildReport(STARTED, RUN, ARGS), [])).not.toContain("lock:");
    });
});
