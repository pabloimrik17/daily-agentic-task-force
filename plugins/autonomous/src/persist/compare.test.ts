import { describe, expect, it } from "vitest";

import { sameBytes, sameText } from "./compare.ts";
// What Linear returned for DOT-122: `- ` bullets came back as `* ` and the link
// destination as `<https://…>`.
import rewrite from "./fixtures/linear-rewrite.json";
// Synthetic, after what Linear does a few seconds after a save: task identifiers in the
// description become links, `DOT-110` → `[DOT-110](https://linear.app/…)`.
import autolink from "./fixtures/linear-autolink.json";

describe("sameText", () => {
    it("the description Linear re-serialised has the text that was written", () => {
        expect(rewrite.read).not.toBe(rewrite.written);
        expect(rewrite.read).toContain("* The description holds");
        expect(rewrite.read).toContain("[link](<https://example.com/docs>)");
        expect(sameText(rewrite.written, rewrite.read)).toBe(true);
    });

    it("the description Linear linked the task identifiers of has the text that was written", () => {
        expect(autolink.read).toContain("[DOT-110](https://linear.app/monolab/issue/DOT-110/");
        expect(sameText(autolink.written, autolink.read)).toBe(true);
    });

    it.each([
        ["- one\n- two", "* one\n* two"],
        ["- one\n- two", "+ one\n+ two"],
        ["* one\n  * nested", "- one\n  - nested"],
        ["[docs](https://example.com)", "[docs](<https://example.com>)"],
        ["snake_case_name", "snake\\_case\\_name"],
        ["Fix the login\n", "Fix the login"],
        ["## Heading\n\nbody", "Heading body"],
        ["`code` and **bold**", "code and bold"],
        ["Ünïcode ñ 日本語 ١٢٣", "Ünïcode — ñ 日本語 ١٢٣"],
        ["See DOT-110.", "See [DOT-110](https://linear.app/monolab/issue/DOT-110/fix-the-login)."],
        ["[docs](https://example.com/docs)", "[docs](https://example.com/docs)"],
        ["[docs](https://example.com/docs)", "[docs](<https://example.com/docs>)"],
        ["[docs](https://example.com/docs)", "[docs](https://example.com/docs 'the docs')"],
        ["[docs](https://example.com/docs)", '[docs](<https://example.com/docs> "the docs")'],
        ["[docs](https://example.com/docs)", "docs"],
        ["![diagram](https://example.com/a.png)", "![diagram](<https://example.com/a.png>)"],
        ["See [DOT-1](u1) and [DOT-2](u2).", "See DOT-1 and DOT-2."],
        ["[a](https://x.test/A_(b))", "[a](<https://x.test/A_(b)>)"],
        ["see https://example.com/docs", "see <https://example.com/docs>"],
        ["[](https://example.com)", ""],
    ])("%j and %j have the same text", (written, read) => {
        expect(sameText(written, read)).toBe(true);
    });

    it.each([
        ["a missing word", "Fix the login redirect", "Fix the redirect"],
        ["a truncated tail", "Fix the login redirect today", "Fix the login redirect to"],
        ["a changed digit", "step 1 of 2", "step 1 of 3"],
        ["a changed letter", "login", "logon"],
        ["an extra word", "Fix the login", "Fix the login now"],
        ["swapped words", "login the Fix", "Fix the login"],
        ["a changed link text", "[DOT-110](https://x.test)", "[DOT-111](https://x.test)"],
        ["a link text gone", "[docs](https://x.test)", "[](https://x.test)"],
        ["a link opened but not closed", "[docs](https://x.test", "docs"],
        ["a link with other text after it", "[docs](https://x.test) now", "[docs](https://x.test)"],
        ["an image alt changed", "![one](https://x.test/a.png)", "![two](https://x.test/a.png)"],
    ])("%s differs", (_name, written, read) => {
        expect(sameText(written, read)).toBe(false);
    });

    it("a null description counts as empty", () => {
        expect(sameText(null, "")).toBe(true);
        expect(sameText("", null)).toBe(true);
        expect(sameText(null, null)).toBe(true);
        expect(sameText(null, "Fix the login")).toBe(false);
        expect(sameText("Fix the login", null)).toBe(false);
    });

    it("a link counts as its text, so its destination is not compared", () => {
        expect(sameText("[docs](https://a.test/one)", "[docs](https://b.test/two)")).toBe(true);
    });

    it("a description of punctuation only has no text", () => {
        expect(sameText("---\n\n* \n", "")).toBe(true);
    });
});

describe("sameBytes", () => {
    it("is true for identical text and ignores trailing whitespace", () => {
        expect(sameBytes("Fix the login", "Fix the login")).toBe(true);
        expect(sameBytes("Fix the login", "Fix the login\n\n  \n")).toBe(true);
        expect(sameBytes("Fix the login\n", "Fix the login")).toBe(true);
    });

    it("sees a re-serialisation, which sameText does not", () => {
        expect(sameBytes(rewrite.written, rewrite.read)).toBe(false);
        expect(sameBytes("- one", "* one")).toBe(false);
    });

    it("keeps leading and inner whitespace", () => {
        expect(sameBytes(" Fix", "Fix")).toBe(false);
        expect(sameBytes("Fix  the login", "Fix the login")).toBe(false);
    });

    it("a null description counts as empty", () => {
        expect(sameBytes(null, "")).toBe(true);
        expect(sameBytes("", null)).toBe(true);
        expect(sameBytes(null, "Fix the login")).toBe(false);
    });
});
