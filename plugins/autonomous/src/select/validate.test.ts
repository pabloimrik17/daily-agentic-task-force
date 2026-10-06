import { describe, expect, it } from "vitest";

import { candidate, workTask } from "./test-fixtures.ts";
import type { SelectionAnswer } from "./types.ts";
import { validateSelection } from "./validate.ts";

function answer(overrides: Partial<SelectionAnswer> = {}): SelectionAnswer {
    return {
        source: "linear",
        id: "TEST-1",
        explanation: "Unblocks two tasks with little effort.",
        exception: null,
        ...overrides,
    };
}

describe("validateSelection", () => {
    it("returns the selected candidate's metadata and explanation", () => {
        const chosen = candidate({
            task: workTask("linear", "TEST-1", undefined, { title: "Synthetic task" }),
            autonomy: "HITL",
        });

        expect(validateSelection(answer(), [chosen], "personal")).toEqual({
            ok: true,
            selected: {
                source: "linear",
                id: "TEST-1",
                title: "Synthetic task",
                stage: "grill-me",
                autonomy: "HITL",
                scope: "personal",
                explanation: "Unblocks two tasks with little effort.",
                exception: null,
            },
        });
    });

    it("accepts another-scope choice with a reason and trims both reasons", () => {
        const chosen = candidate({ scope: "work" });

        expect(
            validateSelection(
                answer({
                    explanation: "  An urgent blocker.  ",
                    exception: "  It blocks a critical delivery.  ",
                }),
                [chosen],
                "personal",
            ),
        ).toMatchObject({
            ok: true,
            selected: {
                scope: "work",
                explanation: "An urgent blocker.",
                exception: "It blocks a critical delivery.",
            },
        });
    });

    it.each([null, "", " \n\t "])(
        "rejects another-scope choice without a reason (%j)",
        (exception) => {
            expect(
                validateSelection(
                    answer({ exception }),
                    [candidate({ scope: "work" })],
                    "personal",
                ),
            ).toEqual({
                ok: false,
                error: "selection linear:TEST-1 is outside machine scope personal and needs a non-empty exception",
            });
        },
    );

    it("rejects an id outside the candidates before validating the explanation", () => {
        expect(
            validateSelection(
                answer({ id: "TEST-99", explanation: "" }),
                [candidate()],
                "personal",
            ),
        ).toEqual({
            ok: false,
            error: "selection linear:TEST-99 is not a candidate",
        });
    });

    it("matches both source and id", () => {
        expect(validateSelection(answer({ source: "beads" }), [candidate()], "personal")).toEqual({
            ok: false,
            error: "selection beads:TEST-1 is not a candidate",
        });
    });

    it.each(["", " \n\t "])(
        "rejects an empty explanation (%j) before checking the exception",
        (explanation) => {
            expect(
                validateSelection(
                    answer({ explanation }),
                    [candidate({ scope: "work" })],
                    "personal",
                ),
            ).toEqual({
                ok: false,
                error: "selection explanation must be non-empty",
            });
        },
    );

    it("drops an exception for an in-scope choice without changing the answer", () => {
        const given = answer({ exception: "Extraneous scope exception." });

        expect(validateSelection(given, [candidate()], "personal")).toMatchObject({
            ok: true,
            selected: { exception: null },
        });
        expect(given.exception).toBe("Extraneous scope exception.");
    });

    it("applies the same scope rule on a work machine", () => {
        expect(
            validateSelection(
                answer({ exception: "A personal task is urgent." }),
                [candidate()],
                "work",
            ),
        ).toMatchObject({
            ok: true,
            selected: { scope: "personal", exception: "A personal task is urgent." },
        });
        expect(validateSelection(answer(), [candidate({ scope: "work" })], "work")).toMatchObject({
            ok: true,
            selected: { scope: "work", exception: null },
        });
    });
});
