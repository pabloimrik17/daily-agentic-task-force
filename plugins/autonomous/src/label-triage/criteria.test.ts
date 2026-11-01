import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { LABELS } from "../label-contract/contract.ts";

// criteria.md is the single text the judgement prompt and the creation helper print;
// it covers the grouped labels only, since triage never decides taken.
const CRITERIA = readFileSync(new URL("./criteria.md", import.meta.url), "utf8");

describe("criteria.md", () => {
    it.each(LABELS.filter((label) => label !== "taken"))("names %s", (label) => {
        expect(CRITERIA).toContain(`\`${label}\``);
    });

    it("says nothing about taken", () => {
        expect(CRITERIA).not.toContain("`taken`");
    });

    it("never says entry group", () => {
        expect(CRITERIA.toLowerCase()).not.toContain("entry group");
    });

    // The label-contract scenario "grill-me with AFK": the autonomy beside grill-me is
    // provisional. criteria.md is hard-wrapped, so compare with whitespace collapsed.
    it("says the grill confirms an autonomy label that grill-me already carries", () => {
        expect(CRITERIA.replace(/\s+/g, " ")).toContain(
            "already carries `AFK` or `HITL`, the grill confirms it",
        );
    });
});
