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
    STAGE_ORDER,
} from "./contract.ts";

// criteria.md wraps lines, backticks label names and lowercases the first
// letter of each meaning, so both sides are compared without those.
function normalise(text: string): string {
    return text.replaceAll("`", "").replaceAll(/\s+/g, " ").toLowerCase();
}

describe("LABELS, GROUPS and COLOURS", () => {
    it("lists exactly the fifteen contract labels", () => {
        expect(LABELS).toEqual([
            "work",
            "personal",
            "AFK",
            "HITL",
            "grill-me",
            "proposal",
            "implement",
            "verify",
            "code-review",
            "qa",
            "external-review",
            "wrap-up",
            "ready-to-merge",
            "taken",
            "triage-me",
        ]);
    });

    it("groups scope, autonomy and stage labels", () => {
        expect(GROUPS).toEqual({
            scope: ["work", "personal"],
            autonomy: ["AFK", "HITL"],
            stage: [
                "grill-me",
                "proposal",
                "implement",
                "verify",
                "code-review",
                "qa",
                "external-review",
                "wrap-up",
                "ready-to-merge",
            ],
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
            implement: "#26b5ce",
            verify: "#d6409f",
            "code-review": "#a3e635",
            qa: "#0d9488",
            "external-review": "#8b5e3c",
            "wrap-up": "#64748b",
            "ready-to-merge": "#15803d",
            work: "#2f80ed",
            personal: "#27ae60",
            taken: "#95a2b3",
            "triage-me": "#f2c94c",
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

    it("states that implement means the task has a proposal and is ready to implement", () => {
        expect(MEANINGS.implement).toBe("The task has a proposal and is ready to implement.");
    });

    it("states that verify means the task is implemented and ready to verify against its proposal", () => {
        expect(MEANINGS.verify).toBe(
            "The task is implemented and ready to verify against its proposal.",
        );
    });

    it("states that code-review means the task is verified and ready for code review", () => {
        expect(MEANINGS["code-review"]).toBe("The task is verified and ready for code review.");
    });

    it("states the meaning of each declared stage label", () => {
        expect(MEANINGS.qa).toBe("The task has passed code review and is ready for QA.");
        expect(MEANINGS["external-review"]).toBe(
            "The task has passed every review stage and is ready for external review.",
        );
        expect(MEANINGS["wrap-up"]).toBe(
            "The task has passed external review and is ready for wrap-up.",
        );
        expect(MEANINGS["ready-to-merge"]).toBe(
            "The task is wrapped up and waits for a person to merge its pull request.",
        );
    });

    it("orders the declared stage labels after code-review", () => {
        expect(STAGE_ORDER.slice(STAGE_ORDER.indexOf("code-review"))).toEqual([
            "code-review",
            "qa",
            "external-review",
            "wrap-up",
            "ready-to-merge",
        ]);
    });

    it("states grill-me without any precedence over AFK and HITL", () => {
        expect(MEANINGS["grill-me"]).toBe(
            "The task must be refined with a human in a grill before anyone works on it.",
        );
    });

    it("keeps triage-me in the vocabulary, in no group, with its colour and a meaning", () => {
        expect(LABELS).toContain("triage-me");
        expect(isContractLabel("triage-me")).toBe(true);
        for (const labels of Object.values(GROUPS)) {
            expect(labels).not.toContain("triage-me");
        }
        expect(COLOURS["triage-me"]).toBe("#f2c94c");
        expect(MEANINGS["triage-me"]).toBeTruthy();
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
        expect(isContractLabel("implement")).toBe(true);
    });

    it("accepts code-review and rejects its near-miss spellings", () => {
        expect(isContractLabel("code-review")).toBe(true);
        expect(isContractLabel("Code Review")).toBe(false);
        expect(isContractLabel("code_review")).toBe(false);
        expect(isContractLabel("codereview")).toBe(false);
    });

    it.each(["qa", "external-review", "wrap-up", "ready-to-merge"])(
        "accepts the declared stage label %s",
        (label) => {
            expect(isContractLabel(label)).toBe(true);
            expect(isStageLabel(label)).toBe(true);
        },
    );

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

    it("code-review with qa: two stage labels are not valid", () => {
        expect(isValidGroup("stage", ["code-review", "qa"])).toBe(false);
    });

    it.each(["qa", "external-review", "wrap-up", "ready-to-merge"])(
        "accepts %s as a single stage label",
        (label) => {
            expect(isValidGroup("stage", [label])).toBe(true);
        },
    );
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

    it("Task in implement: its autonomy is AFK or HITL, never grill-me", () => {
        expect(optionsFor("autonomy", ["personal", "implement"])).toEqual(["AFK", "HITL"]);
    });

    it("Task in verify: its autonomy is AFK or HITL, never grill-me", () => {
        expect(optionsFor("autonomy", ["work", "verify"])).toEqual(["AFK", "HITL"]);
    });
});

describe("optionsFor in code-review", () => {
    it("Task in code-review: its autonomy is AFK or HITL, never grill-me", () => {
        expect(optionsFor("autonomy", ["work", "code-review"])).toEqual(["AFK", "HITL"]);
    });
});

describe("optionsFor in a stage with no implementation", () => {
    it.each(["qa", "external-review", "wrap-up", "ready-to-merge"])(
        "Task in %s: its autonomy is AFK or HITL, never grill-me",
        (stage) => {
            expect(optionsFor("autonomy", ["personal", stage])).toEqual(["AFK", "HITL"]);
        },
    );
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
