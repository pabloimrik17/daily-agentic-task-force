import { describe, expect, it } from "vitest";

import { context } from "./quota-gate/test-fixtures.ts";
import { type HandoffQuestion, runSteps, type Step, type StepOutcome } from "./runner.ts";

function step(id: string, outcome: StepOutcome, ran: string[], questions?: string[]): Step {
    return {
        id,
        run: () => {
            ran.push(id);
            return Promise.resolve({
                step: id,
                tier: "code",
                outcome,
                reasons: [],
                data: null,
                ...(questions === undefined ? {} : { questions: questions.map(question(id)) }),
            });
        },
        render: () => id,
    };
}

const question =
    (stepId: string) =>
    (target: string): HandoffQuestion => ({
        id: `${stepId}:${target}`,
        step: stepId,
        header: target,
        question: `Which ${target}?`,
        options: [
            { label: "Yes", value: "yes", description: "" },
            { label: "Later", value: null, description: "" },
        ],
        multiSelect: false,
    });

const ctx = context(() => Promise.resolve({ ok: false, error: "unused" }));

describe("runSteps", () => {
    it("runs every step and advances when all advance", async () => {
        const ran: string[] = [];
        const run = await runSteps([step("a", "advance", ran), step("b", "advance", ran)], ctx);
        expect(ran).toEqual(["a", "b"]);
        expect(run.outcome).toBe("advance");
        expect(run.results.map((r) => r.step)).toEqual(["a", "b"]);
        expect(run.questions).toEqual([]);
    });

    it.each<StepOutcome>(["wait", "not-evaluable"])("stops at the first %s", async (outcome) => {
        const ran: string[] = [];
        const run = await runSteps([step("a", outcome, ran), step("b", "advance", ran)], ctx);
        expect(ran).toEqual(["a"]);
        expect(run.outcome).toBe(outcome);
        expect(run.results).toHaveLength(1);
    });

    it("moves every step's questions into the run in step order, out of the step results", async () => {
        const ran: string[] = [];
        const run = await runSteps(
            [step("a", "advance", ran, ["x", "y"]), step("b", "advance", ran, ["z"])],
            ctx,
        );
        expect(run.questions.map((q) => q.id)).toEqual(["a:x", "a:y", "b:z"]);
        expect(run.results.map((r) => "questions" in r)).toEqual([false, false]);
    });

    it("gives each step the results of the steps before it", async () => {
        const seen: Record<string, string[]> = {};
        const spy = (id: string): Step => ({
            id,
            run: (context) => {
                seen[id] = context.results.map((r) => r.step);
                return Promise.resolve({
                    step: id,
                    tier: "code",
                    outcome: "advance",
                    reasons: [],
                    data: null,
                });
            },
            render: () => id,
        });
        await runSteps([spy("a"), spy("b"), spy("c")], ctx);

        expect(seen).toEqual({ a: [], b: ["a"], c: ["a", "b"] });
    });
});
