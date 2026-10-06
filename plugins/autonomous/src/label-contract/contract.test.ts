import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { COLOURS, GROUPS, isContractLabel, isValidGroup, LABELS, MEANINGS } from "./contract.ts";

// criteria.md wraps lines, backticks label names and lowercases the first
// letter of each meaning, so both sides are compared without those.
function normalise(text: string): string {
    return text.replaceAll("`", "").replaceAll(/\s+/g, " ").toLowerCase();
}

describe("LABELS, GROUPS and COLOURS", () => {
    it("lists exactly the six contract labels", () => {
        expect(LABELS).toEqual(["work", "personal", "AFK", "HITL", "grill-me", "taken"]);
    });

    it("groups scope and entry labels", () => {
        expect(GROUPS.scope).toEqual(["work", "personal"]);
        expect(GROUPS.entry).toEqual(["AFK", "HITL", "grill-me"]);
    });

    it("assigns one colour per label", () => {
        expect(COLOURS).toEqual({
            AFK: "#5e6ad2",
            HITL: "#eb5757",
            "grill-me": "#f2994a",
            work: "#2f80ed",
            personal: "#27ae60",
            taken: "#95a2b3",
        });
    });

    it("gives every label a meaning", () => {
        for (const label of LABELS) {
            expect(MEANINGS[label]).toBeTruthy();
        }
    });

    it("states that work is Nazaries work, without priority over personal work", () => {
        expect(MEANINGS.work).toBe("Nazaries work.");
        expect(MEANINGS.work).not.toMatch(/priority/i);
    });

    it("states that taken means someone is advancing the task now", () => {
        expect(MEANINGS.taken).toBe(
            "An agent or a person is advancing the task now; it is not selected until the label is removed.",
        );
    });

    // Triage neither derives nor asks about taken, so criteria.md covers the grouped labels only.
    it.each([...GROUPS.scope, ...GROUPS.entry])(
        "states the meaning of %s as criteria.md does",
        (label) => {
            const criteria = normalise(
                readFileSync(new URL("../label-triage/criteria.md", import.meta.url), "utf8"),
            );
            const statements = [
                `${label} is ${MEANINGS[label]}`,
                `${label} means ${MEANINGS[label]}`,
            ].map(normalise);

            expect(
                statements.some((statement) => criteria.includes(statement)),
                `criteria.md does not state the meaning of ${label} given in MEANINGS`,
            ).toBe(true);
        },
    );
});

describe("isContractLabel", () => {
    it("accepts exact spellings", () => {
        expect(isContractLabel("grill-me")).toBe(true);
    });

    it("rejects a near-miss spelling", () => {
        expect(isContractLabel("Grill Me")).toBe(false);
    });

    it("is case-sensitive", () => {
        expect(isContractLabel("afk")).toBe(false);
    });

    it("accepts taken and rejects Taken", () => {
        expect(isContractLabel("taken")).toBe(true);
        expect(isContractLabel("Taken")).toBe(false);
    });
});

describe("isValidGroup", () => {
    it("accepts exactly one scope label", () => {
        expect(isValidGroup("scope", ["personal"])).toBe(true);
    });

    it("rejects both scope labels together", () => {
        expect(isValidGroup("scope", ["work", "personal"])).toBe(false);
    });

    it("rejects zero scope labels", () => {
        expect(isValidGroup("scope", [])).toBe(false);
    });

    it("accepts a single entry label", () => {
        expect(isValidGroup("entry", ["AFK"])).toBe(true);
    });

    it("accepts AFK and grill-me together", () => {
        expect(isValidGroup("entry", ["AFK", "grill-me"])).toBe(true);
    });

    it("rejects AFK and HITL together", () => {
        expect(isValidGroup("entry", ["AFK", "HITL"])).toBe(false);
    });

    it("rejects zero entry labels", () => {
        expect(isValidGroup("entry", [])).toBe(false);
    });
});
