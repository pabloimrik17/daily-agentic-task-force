import { describe, expect, it } from "vitest";

import { context } from "./quota-gate/test-fixtures.ts";
import { runSteps, type Step, type StepOutcome } from "./runner.ts";

function step(id: string, outcome: StepOutcome, ran: string[]): Step {
    return {
        id,
        run: () => {
            ran.push(id);
            return Promise.resolve({ step: id, tier: "code", outcome, reasons: [], data: null });
        },
        render: () => id,
    };
}

const ctx = context(() => Promise.resolve({ ok: false, error: "unused" }));

describe("runSteps", () => {
    it("runs every step and advances when all advance", async () => {
        const ran: string[] = [];
        const run = await runSteps([step("a", "advance", ran), step("b", "advance", ran)], ctx);
        expect(ran).toEqual(["a", "b"]);
        expect(run.outcome).toBe("advance");
        expect(run.results.map((r) => r.step)).toEqual(["a", "b"]);
    });

    it.each<StepOutcome>(["wait", "not-evaluable"])("stops at the first %s", async (outcome) => {
        const ran: string[] = [];
        const run = await runSteps([step("a", outcome, ran), step("b", "advance", ran)], ctx);
        expect(ran).toEqual(["a"]);
        expect(run.outcome).toBe(outcome);
        expect(run.results).toHaveLength(1);
    });
});
