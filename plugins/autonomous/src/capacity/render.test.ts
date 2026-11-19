import { describe, expect, it } from "vitest";

import { capacityStep } from "./step.ts";
import { attempt, capacityContext } from "./test-fixtures.ts";

async function render(options: Parameters<typeof capacityContext>[0]) {
    const result = await capacityStep.run(capacityContext(options));
    return capacityStep.render(result);
}

describe("capacity report", () => {
    it("shows occupied/limit, the source and the attempts of each kind", async () => {
        const text = await render({
            attempts: [attempt("linear:DOT-120:grill-me:1"), attempt("linear:DOT-109:test:1")],
        });
        expect(text).toContain("[capacity] advance (code)");
        expect(text).toMatch(/grill slots\s+1\/1 {2}limit from file {2}full/);
        expect(text).toMatch(/work slots\s+1\/2 {2}limit from file\n/);
        expect(text).toContain("    linear:DOT-120:grill-me:1");
        expect(text).toContain("    linear:DOT-109:test:1");
    });

    it("says a kind is over its limit", async () => {
        const text = await render({
            attempts: [
                attempt("linear:DOT-1:test:1"),
                attempt("linear:DOT-2:test:1"),
                attempt("linear:DOT-3:test:1"),
            ],
        });
        expect(text).toMatch(/work slots\s+3\/2 {2}limit from file {2}over its limit/);
    });

    it("names flag for a limit given as a flag and default for a shipped default", async () => {
        const text = await render({
            args: { loop: true, grills: 2 },
            defaulted: ["runner.parallel"],
        });
        expect(text).toMatch(/grill slots\s+0\/2 {2}limit from flag/);
        expect(text).toMatch(/work slots\s+0\/2 {2}limit from default/);
    });

    it("lists the reasons and shows no kind when it is not evaluable", async () => {
        const ctx = capacityContext();
        const result = await capacityStep.run({
            ...ctx,
            config: { ok: false, path: "/p", error: "/p: missing" },
        });
        const text = capacityStep.render(result);
        expect(text).not.toContain("slots");
        expect(text).toContain("    - /p: missing");
    });

    it("carries the same information in the data for --json", async () => {
        const result = await capacityStep.run(
            capacityContext({
                attempts: [attempt("linear:DOT-120:grill-me:1")],
                args: { loop: true, grills: 2 },
            }),
        );
        expect(JSON.parse(JSON.stringify(result.data))).toEqual({
            grill: {
                occupied: 1,
                limit: 2,
                source: "flag",
                attempts: ["linear:DOT-120:grill-me:1"],
                full: false,
            },
            work: { occupied: 0, limit: 2, source: "file", attempts: [], full: false },
        });
    });
});
