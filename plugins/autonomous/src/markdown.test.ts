import { describe, expect, it } from "vitest";

import { findOutsideFences } from "./markdown.ts";

const isHeading = (line: string) => line === "## Heading";

function find(text: string): number {
    return findOutsideFences(text.split("\n"), isHeading);
}

describe("findOutsideFences", () => {
    it("finds a line that no fence holds", () => {
        expect(find("intro\n## Heading")).toBe(1);
    });

    it("is -1 when nothing matches", () => {
        expect(find("intro\n### Other")).toBe(-1);
    });

    it.each([
        ["backticks", "```md\n## Heading\n```"],
        ["tildes", "~~~\n## Heading\n~~~"],
        ["an indented fence", "   ```\n## Heading\n   ```"],
    ])("skips a match inside a fence of %s", (_name, fence) => {
        expect(find(fence)).toBe(-1);
        expect(find(`${fence}\n## Heading`)).toBe(3);
    });

    it("keeps a longer fence open across a shorter run and the other character", () => {
        expect(find("````\n```\n~~~~\n## Heading\n````\n## Heading")).toBe(5);
    });

    it("does not close a fence on a line that has more than the run", () => {
        expect(find("```\n``` js\n## Heading\n```\n## Heading")).toBe(4);
    });

    it("does not open a fence on a code span that starts a line", () => {
        expect(find("```example```\n## Heading")).toBe(1);
        expect(find("~~~ a ` b\n## Heading\n~~~")).toBe(-1);
    });

    it("treats an unclosed fence as running to the end", () => {
        expect(find("```\n## Heading\n\n## Heading")).toBe(-1);
    });
});
