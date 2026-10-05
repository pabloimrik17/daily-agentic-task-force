import { describe, expect, it } from "vitest";

import { ibkrToolWarnings, KNOWN_IBKR_TOOLS, unknownIbkrTools } from "./ibkr-tools.ts";

describe("ibkr tools", () => {
    it("holds 34 distinct names", () => {
        expect(KNOWN_IBKR_TOOLS).toHaveLength(34);
        expect(new Set(KNOWN_IBKR_TOOLS).size).toBe(34);
    });

    it("reports nothing for the known set alone", () => {
        expect(ibkrToolWarnings(KNOWN_IBKR_TOOLS)).toEqual([]);
    });

    it("reports nothing for an empty list", () => {
        expect(ibkrToolWarnings([])).toEqual([]);
    });

    it("warns once about an unknown tool, naming it", () => {
        const names = [...KNOWN_IBKR_TOOLS, "mcp__ibkr__submit_order", "mcp__ibkr__submit_order"];
        expect(ibkrToolWarnings(names)).toEqual([
            "mcp__ibkr__submit_order is not in the known set of IBKR tools; it was not called",
        ]);
    });

    it("sorts unknown tools and ignores other servers", () => {
        expect(
            unknownIbkrTools(["mcp__ibkr__zeta", "mcp__other__thing", "mcp__ibkr__alpha"]),
        ).toEqual(["mcp__ibkr__alpha", "mcp__ibkr__zeta"]);
    });
});
