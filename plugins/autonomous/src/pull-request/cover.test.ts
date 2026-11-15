import { describe, expect, it } from "vitest";

import { spliceDefinition } from "../persist/splice.ts";
import { workTask } from "../select/test-fixtures.ts";
import { cover } from "./cover.ts";

const URL = "https://linear.app/team/issue/TEST-1";
const DEFINITION =
    "## Definition\n\n### Problem\n\nLogin fails.\n\n### Solution\n\nFix the redirect.\n\n### Non-goals\n\nSSO.\n";

function described(description: string | null, url: string | null = URL) {
    return workTask("linear", "TEST-1", [], { description, url });
}

describe("cover", () => {
    it("holds the link, the Problem and the Solution of a task with a definition", () => {
        const task = described(spliceDefinition("Fix the login", DEFINITION));

        expect(cover(task, null)).toBe(
            `Task: [TEST-1](${URL})\n\n### Problem\n\nLogin fails.\n\n### Solution\n\nFix the redirect.`,
        );
    });

    it("names the parent of a subtask", () => {
        const parent = { id: "TEST-0", url: "https://linear.app/team/issue/TEST-0" };

        expect(cover(described(spliceDefinition(null, DEFINITION)), parent)).toBe(
            `Task: [TEST-1](${URL})\nParent: [TEST-0](${parent.url})\n\n### Problem\n\nLogin fails.\n\n### Solution\n\nFix the redirect.`,
        );
    });

    it("gives the new text once the definition changed", () => {
        const first = spliceDefinition("Fix the login", DEFINITION);
        const second = spliceDefinition(
            first,
            "## Definition\n\n### Problem\n\nLogin fails on Safari.\n\n### Solution\n\nFix the cookie.\n",
        );

        expect(cover(described(second), null)).toBe(
            `Task: [TEST-1](${URL})\n\n### Problem\n\nLogin fails on Safari.\n\n### Solution\n\nFix the cookie.`,
        );
    });

    it("takes the first paragraph of a task triaged straight to proposal", () => {
        const task = described("Fix the login.\nIt redirects twice.\n\nSecond paragraph.");

        expect(cover(task, null)).toBe(
            `Task: [TEST-1](${URL})\n\nFix the login.\nIt redirects twice.`,
        );
    });

    it("takes the first paragraph when the first heading only begins like the definition's", () => {
        const task = described("## Definition of done\n\nUsers can sign in.");

        expect(cover(task, null)).toBe(`Task: [TEST-1](${URL})\n\n## Definition of done`);
    });

    it("keeps a fenced example whose lines look like headings inside the Solution", () => {
        const solution =
            "Use this template.\n\n```md\n## Example\n### Problem\n```\n\nThen ship it.";
        const definition = `## Definition\n\n### Problem\n\nNo template.\n\n### Solution\n\n${solution}\n\n### Non-goals\n\nSSO.\n`;

        expect(cover(described(spliceDefinition(null, definition)), null)).toBe(
            `Task: [TEST-1](${URL})\n\n### Problem\n\nNo template.\n\n### Solution\n\n${solution}`,
        );
    });

    it("holds only the links of a task without a description", () => {
        expect(cover(described(null), null)).toBe(`Task: [TEST-1](${URL})`);
        expect(cover(described("  \n"), null)).toBe(`Task: [TEST-1](${URL})`);
    });

    it("holds only the links of a definition with neither section", () => {
        expect(cover(described("## Definition\n\n### Non-goals\n\nSSO.\n"), null)).toBe(
            `Task: [TEST-1](${URL})`,
        );
    });

    it("cuts a long first paragraph to 500 characters including the ellipsis", () => {
        const text = cover(described(`${"word ".repeat(200)}\n\nNext.`), null);
        const paragraph = text.slice(text.indexOf("\n\n") + 2);

        expect(paragraph).toHaveLength(500);
        expect(paragraph.endsWith("…")).toBe(true);
        expect(paragraph.endsWith(" …")).toBe(false);
    });

    it("writes the id in code when the task has no URL", () => {
        const parent = { id: "bd-9", url: null };

        expect(cover(described("Fix it.", null), parent)).toBe(
            "Task: `TEST-1`\nParent: `bd-9`\n\nFix it.",
        );
        expect(cover({ ...described("Fix it."), url: undefined }, null)).toBe(
            `Task: \`TEST-1\`\n\nFix it.`,
        );
    });
});
