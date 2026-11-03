import { describe, expect, it } from "vitest";

import { DEFINITION_HEADING, ORIGINAL_HEADING, spliceDefinition } from "./splice.ts";

const FIRST = "## Definition\n\n### Problem\n\nLogin fails.\n";
const SECOND = "## Definition\n\n### Problem\n\nLogin fails on Safari.\n\n### Non-goals\n\nSSO.\n";

describe("spliceDefinition", () => {
    it("puts the definition, the separator and the original description in a first grill", () => {
        expect(spliceDefinition("Fix the login", FIRST)).toBe(
            `${FIRST}\n---\n\n${ORIGINAL_HEADING}\n\nFix the login`,
        );
    });

    it("writes the layout literally", () => {
        expect(spliceDefinition("Fix the login", "## Definition\n\nBody\n")).toBe(
            "## Definition\n\nBody\n\n---\n\n## Original description\n\nFix the login",
        );
    });

    it("replaces only the part above the separator in a second grill", () => {
        const once = spliceDefinition("Fix the login", FIRST);
        const twice = spliceDefinition(once, SECOND);
        expect(twice).toBe(`${SECOND}\n---\n\n${ORIGINAL_HEADING}\n\nFix the login`);
        expect(twice).not.toContain("Login fails.");
    });

    it("keeps everything from the separator on byte for byte", () => {
        const below = `\n---\n\n${ORIGINAL_HEADING}\n\n  Fix\t the login  \r\n\n---\n\n## Definition\n\n`;
        const existing = `${DEFINITION_HEADING}\n\nOld definition${below}`;
        expect(spliceDefinition(existing, SECOND)).toBe(`${SECOND.trimEnd()}\n${below}`);
    });

    it("replaces at the first separator only", () => {
        const existing = `${DEFINITION_HEADING}\n\nOld\n\n---\n\n${ORIGINAL_HEADING}\n\nAbove\n\n---\n\n${ORIGINAL_HEADING}\n\nBelow`;
        expect(spliceDefinition(existing, FIRST)).toBe(
            `${FIRST}\n---\n\n${ORIGINAL_HEADING}\n\nAbove\n\n---\n\n${ORIGINAL_HEADING}\n\nBelow`,
        );
    });

    it("ends right after the heading line when the original description is empty", () => {
        expect(spliceDefinition("", FIRST)).toBe(`${FIRST}\n---\n\n${ORIGINAL_HEADING}\n`);
    });

    it("ends right after the heading line when the original description is null", () => {
        expect(spliceDefinition(null, FIRST)).toBe(`${FIRST}\n---\n\n${ORIGINAL_HEADING}\n`);
    });

    it("replaces the definition above an empty original description", () => {
        const once = spliceDefinition(null, FIRST);
        expect(spliceDefinition(once, SECOND)).toBe(`${SECOND}\n---\n\n${ORIGINAL_HEADING}\n`);
    });

    it("treats a description that contains --- but not the layout as original text", () => {
        const description = "Intro\n\n---\n\nMore detail";
        expect(spliceDefinition(description, FIRST)).toBe(
            `${FIRST}\n---\n\n${ORIGINAL_HEADING}\n\n${description}`,
        );
    });

    it("treats a description that starts with the definition heading but lacks the separator as original text", () => {
        const description = `${DEFINITION_HEADING}\n\nWritten by hand\n\n---\n\nTail`;
        expect(spliceDefinition(description, FIRST)).toBe(
            `${FIRST}\n---\n\n${ORIGINAL_HEADING}\n\n${description}`,
        );
    });

    it("treats a quoted layout as original text when the description does not start with the definition heading", () => {
        const description = `Notes\n\n---\n\n${ORIGINAL_HEADING}\n\nQuoted`;
        expect(spliceDefinition(description, FIRST)).toBe(
            `${FIRST}\n---\n\n${ORIGINAL_HEADING}\n\n${description}`,
        );
    });

    it("adds the definition heading when the definition lacks it", () => {
        expect(spliceDefinition("Fix the login", "### Problem\n\nLogin fails.\n")).toBe(
            "## Definition\n\n### Problem\n\nLogin fails.\n\n---\n\n## Original description\n\nFix the login",
        );
    });

    it("does not repeat the heading of a definition that has it", () => {
        expect(spliceDefinition("Fix the login", FIRST).match(/## Definition/g)).toHaveLength(1);
    });

    it("replaces only the part above the separator when a headless definition is grilled again", () => {
        const once = spliceDefinition("Fix the login", "### Problem\n\nLogin fails.\n");
        const twice = spliceDefinition(once, "### Problem\n\nLogin fails on Safari.\n");

        expect(twice).toBe(
            `${DEFINITION_HEADING}\n\n### Problem\n\nLogin fails on Safari.\n\n---\n\n${ORIGINAL_HEADING}\n\nFix the login`,
        );
        expect(twice.match(/## Original description/g)).toHaveLength(1);
        expect(spliceDefinition(once, SECOND)).toBe(
            `${SECOND}\n---\n\n${ORIGINAL_HEADING}\n\nFix the login`,
        );
    });

    it("drops trailing whitespace from the definition", () => {
        expect(spliceDefinition("Fix the login", `${FIRST}\n\n  \n`)).toBe(
            spliceDefinition("Fix the login", FIRST),
        );
    });

    it.each([
        ["Fix the login"],
        [""],
        [null],
        ["Intro\n\n---\n\nMore detail"],
        [`${FIRST}\n---\n\n${ORIGINAL_HEADING}\n\nFix the login`],
    ])("gives the same description however often it is grilled: %j", (original) => {
        expect(spliceDefinition(spliceDefinition(original, FIRST), SECOND)).toBe(
            spliceDefinition(original, SECOND),
        );
    });
});
