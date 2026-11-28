// Spec work-selection, "Stuck tasks": stuck is derived in one place.

import { describe, expect, it } from "vitest";

import { isStuck } from "./excluded.ts";
import type { Exclusion } from "./types.ts";

const attempt = (state: "retained" | "started") => ({
    id: "github:o/r#228:proposal:1" as const,
    state,
    pendingCleanup: false,
});

describe("isStuck", () => {
    it("Retained attempt: an open-attempt exclusion with a retained attempt is stuck", () => {
        expect(isStuck("open-attempt", attempt("retained"))).toBe(true);
    });

    it("Running attempt: an open-attempt exclusion with a started attempt is not stuck", () => {
        expect(isStuck("open-attempt", attempt("started"))).toBe(false);
    });

    it("No free slot: not stuck", () => {
        expect(isStuck("no-free-slot", null)).toBe(false);
    });

    it("makes the repository and prerequisite exclusions stuck, and no other", () => {
        const all: Exclusion[] = [
            "classification",
            "open-attempt",
            "taken",
            "triage-me",
            "labelled-this-run",
            "unsupported-stage",
            "blocked",
            "split",
            "repository",
            "repository-prerequisites",
            "no-free-slot",
            "prerequisites",
        ];

        expect(all.filter((reason) => isStuck(reason, null))).toEqual([
            "repository",
            "repository-prerequisites",
            "prerequisites",
        ]);
    });
});
