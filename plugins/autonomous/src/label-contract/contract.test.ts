import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
    COLOURS,
    DECIDED_GROUPS,
    GROUPS,
    hasStageLabel,
    isAutonomyLabel,
    isContractLabel,
    isStageLabel,
    isValidDecision,
    isValidGroup,
    LABELS,
    MEANINGS,
    optionsFor,
} from "./contract.ts";

// criteria.md wraps lines, backticks label names and lowercases the first
// letter of each meaning, so both sides are compared without those.
function normalise(text: string): string {
    return text.replaceAll("`", "").replaceAll(/\s+/g, " ").toLowerCase();
}

describe("LABELS, GROUPS and COLOURS", () => {
    it("lists exactly the seven contract labels", () => {
        expect(LABELS).toEqual([
            "work",
            "personal",
            "AFK",
            "HITL",
            "grill-me",
            "proposal",
            "taken",
        ]);
    });

    it("groups scope, autonomy and stage labels", () => {
        expect(GROUPS).toEqual({
            scope: ["work", "personal"],
            autonomy: ["AFK", "HITL"],
            stage: ["grill-me", "proposal"],
        });
    });

    it("decides scope and autonomy, and never the stage on its own", () => {
        expect(DECIDED_GROUPS).toEqual(["scope", "autonomy"]);
    });

    it("assigns one colour per label", () => {
        expect(COLOURS).toEqual({
            AFK: "#5e6ad2",
            HITL: "#eb5757",
            "grill-me": "#f2994a",
            proposal: "#bb87fc",
            work: "#2f80ed",
            personal: "#27ae60",
            taken: "#95a2b3",
        });
    });

    it("colours proposal #bb87fc", () => {
        expect(COLOURS.proposal).toBe("#bb87fc");
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

    it("states that proposal means ready for proposal preparation, autonomy decided and any grill over", () => {
        expect(MEANINGS.proposal).toBe(
            "The task is ready for proposal preparation, its autonomy decided and any grill it needed over.",
        );
    });

    it("states grill-me without any precedence over AFK and HITL", () => {
        expect(MEANINGS["grill-me"]).toBe(
            "The task must be refined with a human in a grill before anyone works on it.",
        );
    });

    it("states that taken means someone is advancing the task now", () => {
        expect(MEANINGS.taken).toBe(
            "An agent or a person is advancing the task now; it is not selected until the label is removed.",
        );
    });

    // Triage neither derives nor asks about taken, so criteria.md covers the grouped labels only.
    it.each([...GROUPS.scope, ...GROUPS.autonomy, ...GROUPS.stage])(
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
        expect(isContractLabel("proposal")).toBe(true);
    });

    it("rejects a near-miss spelling", () => {
        expect(isContractLabel("Grill Me")).toBe(false);
        expect(isContractLabel("Proposal")).toBe(false);
    });

    it("is case-sensitive", () => {
        expect(isContractLabel("afk")).toBe(false);
    });

    it("accepts taken and rejects Taken", () => {
        expect(isContractLabel("taken")).toBe(true);
        expect(isContractLabel("Taken")).toBe(false);
    });
});

describe("isAutonomyLabel, isStageLabel and hasStageLabel", () => {
    it("tells autonomy labels from stage labels", () => {
        expect(isAutonomyLabel("HITL")).toBe(true);
        expect(isAutonomyLabel("grill-me")).toBe(false);
        expect(isStageLabel("grill-me")).toBe(true);
        expect(isStageLabel("AFK")).toBe(false);
    });

    it("finds a stage label by exact spelling only", () => {
        expect(hasStageLabel(["work", "proposal"])).toBe(true);
        expect(hasStageLabel(["work", "Proposal", "Grill Me"])).toBe(false);
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

    it("accepts a single autonomy label", () => {
        expect(isValidGroup("autonomy", ["AFK"])).toBe(true);
    });

    it("rejects AFK and HITL together", () => {
        expect(isValidGroup("autonomy", ["AFK", "HITL"])).toBe(false);
    });

    it("rejects grill-me as an autonomy label", () => {
        expect(isValidGroup("autonomy", ["grill-me"])).toBe(false);
    });

    it("accepts a single stage label", () => {
        expect(isValidGroup("stage", ["proposal"])).toBe(true);
    });

    it("rejects two stage labels", () => {
        expect(isValidGroup("stage", ["grill-me", "proposal"])).toBe(false);
    });

    it("rejects a label of another group", () => {
        expect(isValidGroup("stage", ["AFK"])).toBe(false);
    });
});

describe("optionsFor", () => {
    it("offers work and personal for scope", () => {
        expect(optionsFor("scope", [])).toEqual(["work", "personal"]);
    });

    it("offers AFK, HITL and grill-me for autonomy when the task has no stage label", () => {
        expect(optionsFor("autonomy", ["personal"])).toEqual(["AFK", "HITL", "grill-me"]);
    });

    it("offers AFK and HITL only for autonomy when the task has a stage label", () => {
        expect(optionsFor("autonomy", ["personal", "proposal"])).toEqual(["AFK", "HITL"]);
        expect(optionsFor("autonomy", ["grill-me"])).toEqual(["AFK", "HITL"]);
    });
});

describe("isValidDecision", () => {
    it("accepts a grill-me decision for a task with no stage label", () => {
        expect(isValidDecision("autonomy", ["grill-me"], ["work"])).toBe(true);
    });

    it("rejects a grill-me decision for a task with proposal", () => {
        expect(isValidDecision("autonomy", ["grill-me"], ["work", "proposal"])).toBe(false);
    });

    it("rejects AFK with HITL", () => {
        expect(isValidDecision("autonomy", ["AFK", "HITL"], [])).toBe(false);
    });

    it("rejects a label from another group", () => {
        expect(isValidDecision("autonomy", ["work"], [])).toBe(false);
    });

    it("rejects no label", () => {
        expect(isValidDecision("scope", [], [])).toBe(false);
    });

    it("accepts a single scope label", () => {
        expect(isValidDecision("scope", ["work"], ["proposal"])).toBe(true);
    });

    it("checks a stage derivation as a group", () => {
        expect(isValidDecision("stage", ["proposal"], [])).toBe(true);
        expect(isValidDecision("stage", ["grill-me", "proposal"], [])).toBe(false);
    });
});
