import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { CONFIG_SCHEMA } from "./config.ts";
import type { Tracker, TrackerLabel, Trackers } from "./label-triage/trackers/tracker.ts";
import { NOW } from "./quota-gate/test-fixtures.ts";
import { main, type MainDeps } from "./run.ts";
import type { Step, StepOutcome } from "./runner.ts";

function fakeStep(outcome: StepOutcome): Step<{ value: number }> {
    return {
        id: "fake",
        run: () =>
            Promise.resolve({
                step: "fake",
                tier: "code",
                outcome,
                reasons: ["because"],
                data: { value: 42 },
            }),
        render: (result) => `[fake] ${result.outcome} value=${result.data.value}`,
    };
}

function deps(steps: readonly Step[], overrides: Partial<MainDeps> = {}) {
    const out: string[] = [];
    const err: string[] = [];
    const d: MainDeps = {
        now: () => NOW,
        env: {},
        openUsage: () => Promise.resolve({ ok: false, error: "unused" }),
        trackers: () => {
            throw new Error("unused");
        },
        stdout: (t) => out.push(t),
        stderr: (t) => err.push(t),
        steps,
        ...overrides,
    };
    return { d, out, err };
}

describe("main", () => {
    it.each<[StepOutcome, number]>([
        ["advance", 0],
        ["wait", 2],
        ["not-evaluable", 3],
    ])("exits for %s with %i", async (outcome, code) => {
        const { d } = deps([fakeStep(outcome)]);
        expect(await main([], d)).toBe(code);
    });

    it("prints one autonomous.run.v1 JSON document with --json", async () => {
        const { d, out } = deps([fakeStep("wait")]);
        await main(["--json"], d);
        expect(out).toHaveLength(1);
        expect(JSON.parse(out[0] as string)).toEqual({
            schema: "autonomous.run.v1",
            startedAt: NOW.toISOString(),
            steps: [
                {
                    step: "fake",
                    tier: "code",
                    outcome: "wait",
                    reasons: ["because"],
                    data: { value: 42 },
                },
            ],
            outcome: "wait",
        });
    });

    it("renders text through each step's renderer", async () => {
        const { d, out } = deps([fakeStep("advance")]);
        await main([], d);
        expect(out[0]).toBe(
            `autonomous run — started ${NOW.toISOString()}\noutcome: advance\n\n[fake] advance value=42`,
        );
    });

    it("prints usage and exits 1 on an unknown flag", async () => {
        const { d, out, err } = deps([fakeStep("advance")]);
        expect(await main(["--nope"], d)).toBe(1);
        expect(out).toEqual([]);
        expect(err.join("\n")).toContain("Usage: /autonomous:run");
    });

    it("exits 1 when the runner itself fails", async () => {
        const broken: Step = {
            id: "broken",
            run: () => Promise.reject(new Error("boom")),
            render: () => "",
        };
        const { d, err } = deps([broken]);
        expect(await main([], d)).toBe(1);
        expect(err).toEqual(["autonomous run failed: boom"]);
    });
});

describe("main --bootstrap-labels", () => {
    const dir = mkdtempSync(join(tmpdir(), "autonomous-run-"));
    const configPath = join(dir, "config.json");
    writeFileSync(
        configPath,
        JSON.stringify({
            schema: CONFIG_SCHEMA,
            sources: {
                linear: { enabled: true },
                beads: { enabled: false, directory: "/repo" },
                github: { enabled: false, repos: [] },
            },
            judgement: {
                model: "claude-sonnet-5",
                effort: "medium",
                threshold: 0.95,
                cap: 25,
                batch: 20,
            },
        }),
    );
    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    function linear(labels: TrackerLabel[] | string): Tracker {
        const unused = () => Promise.reject(new Error("unused"));
        return {
            source: "linear",
            labelScopes: ["workspace"],
            createsLabels: true,
            listTasks: unused,
            readTask: unused,
            addLabel: unused,
            listLabels: () =>
                Promise.resolve(
                    typeof labels === "string"
                        ? { ok: false, error: labels }
                        : { ok: true, value: labels },
                ),
            createLabel: () => Promise.resolve({ ok: true, value: undefined }),
        };
    }

    function bootstrapDeps(tracker: Tracker, env = { AUTONOMOUS_CONFIG: configPath }) {
        const calls = { steps: 0, openUsage: 0 };
        const step: Step = {
            id: "counted",
            run: () => {
                calls.steps++;
                return Promise.reject(new Error("a step ran"));
            },
            render: () => "",
        };
        const result = deps([step], {
            env,
            openUsage: () => {
                calls.openUsage++;
                return Promise.resolve({ ok: false, error: "unused" });
            },
            // Beads and GitHub are disabled in the configuration, so only Linear is reached.
            trackers: (): Trackers => ({ beads: tracker, github: tracker, linear: tracker }),
        });
        return { ...result, calls };
    }

    it("runs only the bootstrap and prints its report", async () => {
        const { d, out, err, calls } = bootstrapDeps(linear([]));
        expect(await main(["--bootstrap-labels"], d)).toBe(0);
        expect(calls).toEqual({ steps: 0, openUsage: 0 });
        expect(err).toEqual([]);
        expect(out).toEqual([
            [
                `label bootstrap — started ${NOW.toISOString()}`,
                "outcome: advance",
                "  linear    workspace: created work, personal, AFK, HITL, grill-me",
            ].join("\n"),
        ]);
    });

    it("prints one autonomous.bootstrap.v1 JSON document with --json", async () => {
        const { d, out } = bootstrapDeps(linear([]));
        expect(await main(["--bootstrap-labels", "--json"], d)).toBe(0);
        expect(out).toHaveLength(1);
        expect(JSON.parse(out[0] as string)).toMatchObject({
            schema: "autonomous.bootstrap.v1",
            startedAt: NOW.toISOString(),
            outcome: "advance",
            sources: [{ source: "linear", evaluable: true }],
        });
    });

    it("exits 3 when a source is not evaluable", async () => {
        const { d, out, calls } = bootstrapDeps(
            linear("linear label list --all --json: Linear CLI is not authenticated"),
        );
        expect(await main(["--bootstrap-labels"], d)).toBe(3);
        expect(calls.steps).toBe(0);
        expect(out[0]).toContain("outcome: not-evaluable");
    });

    it("exits 3 naming the path when the configuration file is missing", async () => {
        const missing = join(dir, "absent.json");
        const { d, out, err, calls } = bootstrapDeps(linear([]), { AUTONOMOUS_CONFIG: missing });
        expect(await main(["--bootstrap-labels"], d)).toBe(3);
        expect(calls).toEqual({ steps: 0, openUsage: 0 });
        expect(out).toEqual([]);
        expect(err).toHaveLength(1);
        expect(err[0]).toContain(`configuration file not found at ${missing}`);
    });

    it("exits 1 when the bootstrap itself fails", async () => {
        const broken = { ...linear([]), listLabels: () => Promise.reject(new Error("boom")) };
        const { d, err } = bootstrapDeps(broken);
        expect(await main(["--bootstrap-labels"], d)).toBe(1);
        expect(err).toEqual(["autonomous run failed: boom"]);
    });
});
