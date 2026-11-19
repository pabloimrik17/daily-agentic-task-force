import { describe, expect, it } from "vitest";

import { config } from "../label-triage/test-fixtures.ts";
import { capacityStep } from "./step.ts";
import { attempt, capacityContext } from "./test-fixtures.ts";

const GRILL = "linear:DOT-120:grill-me:1";
const GRILL_2 = "linear:DOT-121:grill-me:1";
const TEST = "linear:DOT-109:test:1";
const TEST_2 = "beads:B-7:test:1";
const TEST_3 = "beads:B-8:test:1";

describe("capacity: what occupies a slot", () => {
    it("counts a retained attempt", async () => {
        const result = await capacityStep.run(
            capacityContext({ attempts: [attempt(GRILL, "retained")] }),
        );
        expect(result.data?.grill).toMatchObject({ occupied: 1, attempts: [GRILL] });
    });

    it("counts an attempt launched with a supplied task and still started", async () => {
        const result = await capacityStep.run(
            capacityContext({ attempts: [attempt(GRILL, "started")], args: { apply: true } }),
        );
        expect(result.data?.grill.occupied).toBe(1);
    });

    it("counts pending and created attempts", async () => {
        const result = await capacityStep.run(
            capacityContext({ attempts: [attempt(TEST, "pending"), attempt(TEST_2, "created")] }),
        );
        expect(result.data?.work.occupied).toBe(2);
    });

    it("counts a completed attempt with a pending cleanup", async () => {
        const result = await capacityStep.run(
            capacityContext({ attempts: [attempt(TEST, "completed")], cleanups: [TEST] }),
        );
        expect(result.data?.work).toMatchObject({ occupied: 1, attempts: [TEST] });
    });

    it("does not count completed, aborted or discarded attempts, and counts no session made by hand", async () => {
        const result = await capacityStep.run(
            capacityContext({
                attempts: [
                    attempt(GRILL, "completed"),
                    attempt(TEST, "aborted"),
                    attempt(TEST_2, "discarded"),
                ],
            }),
        );
        expect(result.data?.grill.occupied).toBe(0);
        expect(result.data?.work.occupied).toBe(0);
    });

    it("counts none after reconcile finalised the only open grill attempt", async () => {
        const finalised = attempt(GRILL, "completed", { before: "started", action: "finalised" });
        const result = await capacityStep.run(
            capacityContext({ attempts: [finalised], args: { apply: true } }),
        );
        expect(result.data?.grill).toMatchObject({ occupied: 0, attempts: [] });
    });

    it("counts none, without --apply, for attempts reconcile would finalise or abort", async () => {
        const result = await capacityStep.run(
            capacityContext({
                attempts: [
                    attempt(GRILL, "started", { action: "finalised" }),
                    attempt(TEST, "pending", { action: "aborted" }),
                    attempt(TEST_2, "started", { action: "observed" }),
                ],
                args: { loop: true },
            }),
        );
        expect(result.data?.grill).toMatchObject({ occupied: 0, attempts: [] });
        expect(result.data?.work).toMatchObject({ occupied: 1, attempts: [TEST_2] });
    });
});

describe("capacity: two kinds of slot", () => {
    it("counts a grill-me attempt as a grill slot only", async () => {
        const result = await capacityStep.run(capacityContext({ attempts: [attempt(GRILL)] }));
        expect(result.data?.grill.occupied).toBe(1);
        expect(result.data?.work.occupied).toBe(0);
    });

    it("counts a test attempt as a work slot", async () => {
        const result = await capacityStep.run(capacityContext({ attempts: [attempt(TEST)] }));
        expect(result.data?.grill.occupied).toBe(0);
        expect(result.data?.work).toMatchObject({ occupied: 1, attempts: [TEST] });
    });

    it("counts a proposal attempt as a work slot", async () => {
        const result = await capacityStep.run(
            capacityContext({ attempts: [attempt("linear:DOT-5:proposal:1")] }),
        );
        expect(result.data?.work.occupied).toBe(1);
    });
});

describe("capacity: limits", () => {
    it("takes the shipped limits", async () => {
        const result = await capacityStep.run(capacityContext());
        expect(result.data).toEqual({
            grill: { occupied: 0, limit: 1, source: "file", attempts: [], full: false },
            work: { occupied: 0, limit: 2, source: "file", attempts: [], full: false },
        });
    });

    it("lets a flag replace the file value for that kind", async () => {
        const result = await capacityStep.run(
            capacityContext({
                args: { loop: true, parallel: 1 },
                defaulted: ["runner.grills"],
            }),
        );
        expect(result.data?.work).toMatchObject({ limit: 1, source: "flag" });
        expect(result.data?.grill).toMatchObject({ limit: 1, source: "default" });
    });

    it("is full for a limit of zero with no open attempt", async () => {
        const result = await capacityStep.run(capacityContext({ args: { loop: true, grills: 0 } }));
        expect(result.data?.grill).toMatchObject({ occupied: 0, limit: 0, full: true });
        expect(result.data?.work.full).toBe(false);
        expect(result.outcome).toBe("advance");
    });

    it("is full at the limit and over it", async () => {
        const result = await capacityStep.run(
            capacityContext({ attempts: [attempt(TEST), attempt(TEST_2), attempt(TEST_3)] }),
        );
        expect(result.data?.work).toMatchObject({ occupied: 3, limit: 2, full: true });
    });
});

describe("capacity: only the loop is bound", () => {
    const FULL = [attempt(GRILL), attempt(TEST), attempt(TEST_2)];

    it("waits in an iteration with every kind full, naming both kinds", async () => {
        const result = await capacityStep.run(
            capacityContext({ attempts: FULL, args: { loop: true } }),
        );
        expect(result.outcome).toBe("wait");
        expect(result.reasons).toEqual([
            "every kind of slot is full: grill slots 1/1, work slots 2/2",
        ]);
    });

    it("waits when a kind with limit zero and the other kind are full", async () => {
        const result = await capacityStep.run(
            capacityContext({
                attempts: [attempt(TEST), attempt(TEST_2)],
                args: { loop: true, grills: 0 },
            }),
        );
        expect(result.outcome).toBe("wait");
    });

    it("advances in an iteration with one kind free", async () => {
        const result = await capacityStep.run(
            capacityContext({ attempts: [attempt(GRILL), attempt(TEST)], args: { loop: true } }),
        );
        expect(result.outcome).toBe("advance");
        expect(result.data?.work.full).toBe(false);
    });

    it("advances outside an iteration whatever the counts", async () => {
        const result = await capacityStep.run(capacityContext({ attempts: FULL }));
        expect(result.outcome).toBe("advance");
        expect(result.data?.grill.full).toBe(true);
        expect(result.data?.work.full).toBe(true);
    });

    it("advances a manual run over the limit and counts the launch", async () => {
        const result = await capacityStep.run(
            capacityContext({
                attempts: [attempt(GRILL), attempt(GRILL_2)],
                args: { apply: true, task: { source: "linear", id: "DOT-121" } },
            }),
        );
        expect(result.outcome).toBe("advance");
        expect(result.data?.grill).toMatchObject({ occupied: 2, limit: 1, full: true });
    });
});

describe("capacity: not evaluable", () => {
    it("names the path when the configuration cannot be loaded", async () => {
        const path = "/home/me/.config/autonomous/config.json";
        const error = `configuration file not found at ${path}; create it from the example`;
        const ctx = { ...capacityContext(), config: { ok: false as const, path, error } };
        const result = await capacityStep.run(ctx);
        expect(result.outcome).toBe("not-evaluable");
        expect(result.reasons).toEqual([error]);
        expect(result.data).toBeNull();
    });

    it("is not evaluable when reconcile has not run", async () => {
        const result = await capacityStep.run({ ...capacityContext(), results: [] });
        expect(result.outcome).toBe("not-evaluable");
        expect(result.reasons).toEqual(["the reconcile step has not run"]);
    });

    it("reads the limits from the loaded configuration", async () => {
        const settings = { ...config(), runner: { grills: 3, parallel: 4, intervalMinutes: 5 } };
        const result = await capacityStep.run(capacityContext({ config: settings }));
        expect(result.data?.grill.limit).toBe(3);
        expect(result.data?.work.limit).toBe(4);
    });
});
