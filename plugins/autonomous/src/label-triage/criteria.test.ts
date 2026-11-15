import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { isUngroupedLabel, LABELS } from "../label-contract/contract.ts";

// criteria.md is the single text the judgement prompt and the creation helper print;
// it covers the grouped labels only, since triage never decides taken or triage-me.
const CRITERIA = readFileSync(new URL("./criteria.md", import.meta.url), "utf8");

describe("criteria.md", () => {
    it.each(LABELS.filter((label) => !isUngroupedLabel(label)))("names %s", (label) => {
        expect(CRITERIA).toContain(`\`${label}\``);
    });

    it.each(LABELS.filter(isUngroupedLabel))("says nothing about %s", (label) => {
        expect(CRITERIA).not.toContain(`\`${label}\``);
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
