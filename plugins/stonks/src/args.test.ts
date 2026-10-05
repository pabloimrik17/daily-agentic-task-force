import { describe, expect, it } from "vitest";

import { parseArgs, USAGE } from "./args.ts";

describe("parseArgs", () => {
    it("accepts no argument", () => {
        expect(parseArgs([])).toEqual({ ok: true, args: { only: null } });
    });

    it.each(["sources", "watchlist"] as const)("accepts --only %s", (only) => {
        expect(parseArgs(["--only", only])).toEqual({ ok: true, args: { only } });
    });

    it.each([
        [["--only", "portfolio"]],
        [["--only"]],
        [["sources"]],
        [["--only", "sources", "extra"]],
        [["--only", "sources", "--only", "watchlist"]],
        [["--force"]],
    ])("rejects %j", (argv) => {
        expect(parseArgs(argv).ok).toBe(false);
    });

    it("exports a usage line naming the flag", () => {
        expect(USAGE).toContain("--only sources|watchlist");
    });
});
