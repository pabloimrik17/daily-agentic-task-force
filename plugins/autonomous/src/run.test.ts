import { describe, expect, it } from "vitest";

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

function deps(steps: readonly Step[]) {
    const out: string[] = [];
    const err: string[] = [];
    const d: MainDeps = {
        now: () => NOW,
        openUsage: () => Promise.resolve({ ok: false, error: "unused" }),
        stdout: (t) => out.push(t),
        stderr: (t) => err.push(t),
        steps,
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
