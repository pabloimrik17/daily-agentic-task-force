import { describe, expect, it } from "vitest";

import { sameBytes, sameText } from "./compare.ts";
// What Linear returned for DOT-122 (2026-11-03): `- ` bullets came back as `* ` and the link
// destination as `<https://…>`.
import rewrite from "./fixtures/linear-rewrite.json";

describe("sameText", () => {
    it("the description Linear re-serialised has the text that was written", () => {
        expect(rewrite.read).not.toBe(rewrite.written);
        expect(rewrite.read).toContain("* The description holds");
        expect(rewrite.read).toContain("[link](<https://example.com/docs>)");
        expect(sameText(rewrite.written, rewrite.read)).toBe(true);
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
