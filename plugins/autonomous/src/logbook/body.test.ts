import { describe, expect, it } from "vitest";

import { checkBody, MAX_WORDS, REQUIRED_SECTIONS } from "./body.ts";

const HOME = "/Users/someone";

function body(sections: Record<string, string>): string {
    return Object.entries(sections)
        .map(([name, text]) => `### ${name}\n${text}`)
        .join("\n\n");
}

const minimal = {
    "What I did": "Grilled the task and fixed the glossary.",
    Decisions: "none",
    Assumptions: "none",
    "Next stage": "Proposal.",
};

const words = (count: number): string => Array.from({ length: count }, () => "word").join(" ");

describe("checkBody", () => {
    it("accepts a minimal body with Decisions and Assumptions saying none", () => {
        const check = checkBody(body(minimal), HOME);
        expect(check.broken).toEqual([]);
        expect(check.words).toBeLessThan(MAX_WORDS);
    });

    it("names the missing section", () => {
        const { Assumptions: _omitted, ...rest } = minimal;
        const check = checkBody(body(rest), HOME);
        expect(check.broken).toHaveLength(1);
        expect(check.broken[0]).toContain("### Assumptions");
    });

    it("gives the word count and the limit when the body is too long", () => {
        // The four headings and their text are 20 words; pad What I did to reach 340 in all.
        const base = checkBody(body(minimal), HOME).words;
        const long = body({ ...minimal, "What I did": words(340 - (base - 7)) });
        const check = checkBody(long, HOME);
        expect(check.words).toBe(340);
        expect(check.broken).toEqual(["the body has 340 words, over the limit of 300"]);
    });

    it("allows a stage section within the limit", () => {
        const check = checkBody(body({ ...minimal, Proposal: "The change is proposed." }), HOME);
        expect(check.broken).toEqual([]);
    });

    it("names the rule, not the path, when the home directory appears", () => {
        const text = body({ ...minimal, Decisions: `Edited ${HOME}/work/notes.md` });
        const check = checkBody(text, HOME);
        expect(check.broken).toEqual(["the body names this machine's home directory"]);
        expect(check.broken.join(" ")).not.toContain(HOME);
    });

    it("skips the home rule when the home directory is empty", () => {
        const check = checkBody(body({ ...minimal, Decisions: "Edited /Users/x/a.md" }), "");
        expect(check.broken).toEqual([]);
    });

    it("reports every rule a body breaks at once", () => {
        const { "Next stage": _omitted, ...rest } = minimal;
        const text = body({ ...rest, "What I did": `${HOME} ${words(310)}` });
        const check = checkBody(text, HOME);
        expect(check.broken).toHaveLength(3);
        expect(check.broken.join("\n")).toContain("### Next stage");
        expect(check.broken.join("\n")).toContain("over the limit of 300");
        expect(check.broken.join("\n")).toContain("home directory");
    });

    it("rejects an empty What I did, up to the next heading", () => {
        const check = checkBody(body({ ...minimal, "What I did": "  \n" }), HOME);
        expect(check.broken).toEqual(['the section "### What I did" is empty']);
    });

    it("rejects an empty What I did at the end of the body", () => {
        const text = `### Decisions\nnone\n\n### Assumptions\nnone\n\n### Next stage\nx\n\n### What I did\n\n`;
        expect(checkBody(text, HOME).broken).toEqual(['the section "### What I did" is empty']);
    });

    it("does not take a deeper or longer heading for a required section", () => {
        const text = body({ ...minimal }).replace("### Decisions", "#### Decisions");
        expect(checkBody(text, HOME).broken).toHaveLength(1);
        expect(REQUIRED_SECTIONS).toContain("Decisions");
    });
});
