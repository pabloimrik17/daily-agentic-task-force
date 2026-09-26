import { describe, expect, it } from "vitest";

import {
    COLOURS,
    GROUPS,
    groupOf,
    isContractLabel,
    isValidGroup,
    LABELS,
    MEANINGS,
} from "./contract.ts";

describe("LABELS, GROUPS and COLOURS", () => {
    it("lists exactly the five contract labels", () => {
        expect(LABELS).toEqual(["work", "personal", "AFK", "HITL", "grill-me"]);
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
        });
    });

    it("gives every label a meaning", () => {
        for (const label of LABELS) {
            expect(MEANINGS[label]).toBeTruthy();
        }
    });
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
});

describe("groupOf", () => {
    it("assigns work and personal to scope", () => {
        expect(groupOf("work")).toBe("scope");
        expect(groupOf("personal")).toBe("scope");
    });

    it("assigns AFK, HITL and grill-me to entry", () => {
        expect(groupOf("AFK")).toBe("entry");
        expect(groupOf("HITL")).toBe("entry");
        expect(groupOf("grill-me")).toBe("entry");
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
