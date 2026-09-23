import { describe, expect, it } from "vitest";

import { parseArgs } from "./args.ts";

describe("parseArgs", () => {
    it("defaults to no account, cached read and text output", () => {
        expect(parseArgs([])).toEqual({
            ok: true,
            args: { account: undefined, force: false, json: false },
        });
    });

    it("reads every flag", () => {
        expect(parseArgs(["--account", "claude@123", "--force", "--json"])).toEqual({
            ok: true,
            args: { account: "claude@123", force: true, json: true },
        });
    });

    it.each([
        [["--verbose"], "unrecognised argument: --verbose"],
        [["claude"], "unrecognised argument: claude"],
        [["--account"], "--account requires a provider key"],
        [["--account", "--json"], "--account requires a provider key"],
        [["--account", "a", "--account", "b"], "--account given more than once"],
    ])("rejects %j", (argv, error) => {
        expect(parseArgs(argv)).toEqual({ ok: false, error });
    });
});
