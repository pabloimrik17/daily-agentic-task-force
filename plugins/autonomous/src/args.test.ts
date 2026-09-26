import { describe, expect, it } from "vitest";

import { parseArgs } from "./args.ts";

describe("parseArgs", () => {
    it("defaults to no account, cached read, text output, no apply and no bootstrap", () => {
        expect(parseArgs([])).toEqual({
            ok: true,
            args: {
                account: undefined,
                force: false,
                json: false,
                apply: false,
                bootstrapLabels: false,
            },
        });
    });

    it("reads every flag", () => {
        expect(parseArgs(["--account", "claude@123", "--force", "--json", "--apply"])).toEqual({
            ok: true,
            args: {
                account: "claude@123",
                force: true,
                json: true,
                apply: true,
                bootstrapLabels: false,
            },
        });
    });

    it("reads --bootstrap-labels alone", () => {
        expect(parseArgs(["--bootstrap-labels"])).toEqual({
            ok: true,
            args: {
                account: undefined,
                force: false,
                json: false,
                apply: false,
                bootstrapLabels: true,
            },
        });
    });

    it("reads --bootstrap-labels combined with --json", () => {
        expect(parseArgs(["--bootstrap-labels", "--json"])).toEqual({
            ok: true,
            args: {
                account: undefined,
                force: false,
                json: true,
                apply: false,
                bootstrapLabels: true,
            },
        });
    });

    it.each([
        [["--verbose"], "unrecognised argument: --verbose"],
        [["claude"], "unrecognised argument: claude"],
        [["--account"], "--account requires a provider key"],
        [["--account", "--json"], "--account requires a provider key"],
        [["--account", "a", "--account", "b"], "--account given more than once"],
        [["--bootstrap-labels", "--apply"], "--bootstrap-labels can only be combined with --json"],
        [["--bootstrap-labels", "--force"], "--bootstrap-labels can only be combined with --json"],
        [
            ["--bootstrap-labels", "--account", "x"],
            "--bootstrap-labels can only be combined with --json",
        ],
        [
            ["--json", "--bootstrap-labels", "--apply"],
            "--bootstrap-labels can only be combined with --json",
        ],
    ])("rejects %j", (argv, error) => {
        expect(parseArgs(argv)).toEqual({ ok: false, error });
    });
});
