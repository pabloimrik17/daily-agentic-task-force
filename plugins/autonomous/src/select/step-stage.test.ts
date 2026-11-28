// Stage order in the step (spec work-selection, "Most advanced stage first").

import { rmSync } from "node:fs";

import { afterEach, describe, expect, it } from "vitest";

import { ALL_PASSED } from "../review-bots/test-fixtures.ts";
import { stateWithWorkspace } from "../transition/test-fixtures.ts";
import { selectStep } from "./step.ts";
import {
    fakeChezmoi,
    fakePullRequests,
    fakeReader,
    fakeSelection,
    selectContext,
    workTask,
} from "./test-fixtures.ts";

const GRILL = ["personal", "grill-me"];
const PROPOSAL = ["personal", "AFK", "proposal"];

function readers(calls: string[], tasks: ReturnType<typeof workTask>[]) {
    return [fakeReader("linear", tasks, calls)];
}

const kept: string[] = [];

afterEach(() => {
    for (const directory of kept.splice(0)) {
        rmSync(directory, { recursive: true, force: true });
    }
});

describe("select: most advanced stage first", () => {
    it("selects the only proposal candidate by code and sets the grill-me ones aside", async () => {
        const calls: string[] = [];
        const selection = fakeSelection(() => ({ ok: false, error: "not expected" }));
        const result = await selectStep.run(
            selectContext({
                calls,
                readers: readers(calls, [
                    workTask("linear", "G-1", GRILL),
                    workTask("linear", "P-1", PROPOSAL),
                    workTask("linear", "G-2", GRILL),
                ]),
                selection,
            }),
        );

        expect(result.outcome).toBe("advance");
        expect(result.tier).toBe("code");
        expect(result.data.selected).toMatchObject({ id: "P-1", stage: "proposal" });
        expect(result.data.candidates.map((c) => c.id)).toEqual(["P-1"]);
        expect(result.data.setAside.map((c) => c.id)).toEqual(["G-1", "G-2"]);
        expect(result.data.excluded).toEqual([]);
        expect(selection.requests).toEqual([]);
    });

    it("Implementation before proposal: selects the implement candidate and sets the proposal one aside", async () => {
        const calls: string[] = [];
        const selection = fakeSelection(() => ({ ok: false, error: "not expected" }));
        const result = await selectStep.run(
            selectContext({
                calls,
                readers: readers(calls, [
                    workTask("linear", "P-1", PROPOSAL),
                    workTask("linear", "I-1", ["personal", "AFK", "implement"]),
                ]),
                selection,
            }),
        );

        expect(result.outcome).toBe("advance");
        expect(result.data.selected).toMatchObject({ id: "I-1", stage: "implement" });
        expect(result.data.setAside.map((c) => c.id)).toEqual(["P-1"]);
    });

    it("External review before code review: selects the external-review candidate and sets the code-review one aside", async () => {
        const calls: string[] = [];
        // E-1's pull request is settled, so it is not waiting for its review bots.
        const { state, workspace } = await stateWithWorkspace({ source: "linear", id: "E-1" });
        kept.push(state, workspace);
        const result = await selectStep.run(
            selectContext({
                calls,
                readers: readers(calls, [
                    workTask("linear", "C-1", ["personal", "AFK", "code-review"]),
                    workTask("linear", "E-1", ["personal", "HITL", "external-review"]),
                ]),
                pullRequests: fakePullRequests(calls, { checkRuns: ALL_PASSED }),
                state,
            }),
        );

        expect(result.data.selected).toMatchObject({ id: "E-1", stage: "external-review" });
        expect(result.data.setAside.map((c) => c.id)).toEqual(["C-1"]);
    });

    it("gives the LLM the two proposal candidates only", async () => {
        const calls: string[] = [];
        const selection = fakeSelection(() => ({
            ok: true,
            answer: { source: "linear", id: "P-2", explanation: "Sooner.", exception: null },
        }));
        const result = await selectStep.run(
            selectContext({
                calls,
                readers: readers(calls, [
                    workTask("linear", "P-1", PROPOSAL),
                    workTask("linear", "G-1", GRILL),
                    workTask("linear", "P-2", PROPOSAL),
                ]),
                selection,
            }),
        );

        expect(result.tier).toBe("llm");
        expect(selection.requests).toHaveLength(1);
        expect(selection.requests[0]?.candidates.map((c) => c.task.id)).toEqual(["P-1", "P-2"]);
        expect(result.reasons).toEqual(["selected linear → P-2 for proposal, from 2 candidates"]);
        expect(result.data.setAside.map((c) => c.id)).toEqual(["G-1"]);
    });

    it("selects a candidate of the other scope at a later stage as a machine-scope exception", async () => {
        const calls: string[] = [];
        const selection = fakeSelection(() => ({ ok: false, error: "not expected" }));
        const result = await selectStep.run(
            selectContext({
                calls,
                chezmoi: fakeChezmoi({ machineType: "work" }, calls),
                readers: readers(calls, [
                    workTask("linear", "W-1", ["work", "grill-me"]),
                    workTask("linear", "P-1", PROPOSAL),
                ]),
                selection,
            }),
        );

        expect(result.data.selected).toMatchObject({
            id: "P-1",
            scope: "personal",
            exception: expect.stringContaining("only candidate") as string,
        });
        expect(result.data.setAside.map((c) => c.id)).toEqual(["W-1"]);
    });

    it("keeps every candidate and sets none aside at the same stage", async () => {
        const calls: string[] = [];
        const selection = fakeSelection(() => ({
            ok: true,
            answer: { source: "linear", id: "G-1", explanation: "Sooner.", exception: null },
        }));
        const result = await selectStep.run(
            selectContext({
                calls,
                readers: readers(calls, [
                    workTask("linear", "G-1", GRILL),
                    workTask("linear", "G-2", GRILL),
                ]),
                selection,
            }),
        );

        expect(result.data.candidates).toHaveLength(2);
        expect(result.data.setAside).toEqual([]);
    });

    it("renders the set-aside candidate apart from the excluded tasks", async () => {
        const calls: string[] = [];
        const result = await selectStep.run(
            selectContext({
                calls,
                readers: readers(calls, [
                    workTask("linear", "G-1", GRILL),
                    workTask("linear", "P-1", PROPOSAL),
                    workTask("linear", "T-1", [...GRILL, "taken"]),
                ]),
            }),
        );

        const text = selectStep.render(result);
        expect(text).toContain("    linear → G-1 → Task G-1 (personal, grill-me)");
        expect(text.indexOf("set aside")).toBeLessThan(text.indexOf("excluded:"));
        expect(text.slice(text.indexOf("excluded:"))).not.toContain("G-1");
    });
});

describe("select: slots in a loop", () => {
    function capacity(grillFull: boolean, workFull = false) {
        const kind = { occupied: 0, limit: 1, source: "default", attempts: [] };
        return {
            step: "capacity",
            tier: "code" as const,
            outcome: "advance" as const,
            reasons: [],
            data: {
                grill: { ...kind, full: grillFull },
                work: { ...kind, full: workFull },
            },
        };
    }

    it("excludes the grill-me task as no free slot and selects the proposal one, in a loop", async () => {
        const calls: string[] = [];
        const result = await selectStep.run(
            selectContext({
                calls,
                readers: readers(calls, [
                    workTask("linear", "G-1", GRILL),
                    workTask("linear", "P-1", PROPOSAL),
                ]),
                results: [capacity(true)],
                args: { loop: true },
            }),
        );

        expect(result.data.excluded).toMatchObject([{ id: "G-1", reason: "no-free-slot" }]);
        expect(result.data.selected).toMatchObject({ id: "P-1" });
        expect(result.data.setAside).toEqual([]);
    });

    it("excludes the proposal task as no free slot and selects the grill-me one, in a loop", async () => {
        const calls: string[] = [];
        const result = await selectStep.run(
            selectContext({
                calls,
                readers: readers(calls, [
                    workTask("linear", "G-1", GRILL),
                    workTask("linear", "P-1", PROPOSAL),
                ]),
                results: [capacity(false, true)],
                args: { loop: true },
            }),
        );

        expect(result.data.excluded).toMatchObject([{ id: "P-1", reason: "no-free-slot" }]);
        expect(result.data.selected).toMatchObject({ id: "G-1" });
        expect(result.data.setAside).toEqual([]);
    });

    it("applies no slot outside a loop", async () => {
        const calls: string[] = [];
        const result = await selectStep.run(
            selectContext({
                calls,
                readers: readers(calls, [workTask("linear", "G-1", GRILL)]),
                results: [capacity(true)],
            }),
        );

        expect(result.data.excluded).toEqual([]);
        expect(result.data.selected).toMatchObject({ id: "G-1" });
    });

    it("applies no slot in a loop when capacity could not be evaluated", async () => {
        const calls: string[] = [];
        const result = await selectStep.run(
            selectContext({
                calls,
                readers: readers(calls, [workTask("linear", "G-1", GRILL)]),
                results: [{ ...capacity(true), outcome: "not-evaluable", data: null }],
                args: { loop: true },
            }),
        );

        expect(result.data.selected).toMatchObject({ id: "G-1" });
    });
});
