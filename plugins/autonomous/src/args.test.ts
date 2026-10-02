import { describe, expect, it } from "vitest";

import { parseArgs, type RunArgs } from "./args.ts";

const DEFAULTS: RunArgs = {
    account: undefined,
    force: false,
    json: false,
    apply: false,
    bootstrapLabels: false,
    noHandoff: false,
    answers: [],
};

function accepted(overrides: Partial<RunArgs>) {
    return { ok: true, args: { ...DEFAULTS, ...overrides } };
}

describe("parseArgs", () => {
    it("defaults to no account, cached read, text output, no apply, no bootstrap and a handoff", () => {
        expect(parseArgs([])).toEqual(accepted({}));
    });

    it("reads every flag", () => {
        expect(parseArgs(["--account", "claude@123", "--force", "--json", "--apply"])).toEqual(
            accepted({ account: "claude@123", force: true, json: true, apply: true }),
        );
    });

    it("reads --bootstrap-labels alone", () => {
        expect(parseArgs(["--bootstrap-labels"])).toEqual(accepted({ bootstrapLabels: true }));
    });

    it("reads --bootstrap-labels combined with --json", () => {
        expect(parseArgs(["--bootstrap-labels", "--json"])).toEqual(
            accepted({ bootstrapLabels: true, json: true }),
        );
    });

    it("reads --no-handoff alone", () => {
        expect(parseArgs(["--no-handoff"])).toEqual(accepted({ noHandoff: true }));
    });

    it("reads --no-handoff combined with every run flag", () => {
        expect(
            parseArgs(["--account", "claude", "--force", "--json", "--apply", "--no-handoff"]),
        ).toEqual(
            accepted({ account: "claude", force: true, json: true, apply: true, noHandoff: true }),
        );
    });

    it("reads one --answer with --apply", () => {
        expect(parseArgs(["--apply", "--answer", "label-triage:beads:X-12:entry=HITL"])).toEqual(
            accepted({
                apply: true,
                answers: [{ id: "label-triage:beads:X-12:entry", values: ["HITL"] }],
            }),
        );
    });

    it("reads repeated --answer with --apply --json, splitting at the first = and then at commas", () => {
        expect(
            parseArgs([
                "--answer",
                "label-triage:github:owner/repo#12:entry=HITL,grill-me",
                "--apply",
                "--answer",
                "label-triage:linear:DOT-104:scope=work",
                "--json",
                "--answer",
                "other:a=b=c",
            ]),
        ).toEqual(
            accepted({
                apply: true,
                json: true,
                answers: [
                    { id: "label-triage:github:owner/repo#12:entry", values: ["HITL", "grill-me"] },
                    { id: "label-triage:linear:DOT-104:scope", values: ["work"] },
                    { id: "other:a", values: ["b=c"] },
                ],
            }),
        );
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
        [
            ["--bootstrap-labels", "--no-handoff"],
            "--no-handoff cannot be combined with --bootstrap-labels or --answer",
        ],
        [
            ["--apply", "--no-handoff", "--answer", "a:b=c"],
            "--no-handoff cannot be combined with --bootstrap-labels or --answer",
        ],
        [["--answer", "a:b=HITL"], "--answer requires --apply"],
        [["--json", "--answer", "a:b=HITL"], "--answer requires --apply"],
        [
            ["--apply", "--force", "--answer", "a:b=HITL"],
            "--answer can only be combined with --apply and --json",
        ],
        [
            ["--apply", "--account", "claude", "--answer", "a:b=HITL"],
            "--answer can only be combined with --apply and --json",
        ],
        [
            ["--bootstrap-labels", "--answer", "a:b=HITL"],
            "--bootstrap-labels can only be combined with --json",
        ],
        [["--apply", "--answer"], "--answer requires <id>=<value>[,<value>]"],
        [["--apply", "--answer", "--json"], "--answer requires <id>=<value>[,<value>]"],
        [["--apply", "--answer", "a:b"], "--answer requires <id>=<value>[,<value>]"],
        [["--apply", "--answer", "=HITL"], "--answer =HITL has an empty id"],
        [["--apply", "--answer", "a:b="], "--answer a:b has an empty value"],
        [["--apply", "--answer", "a:b=HITL,"], "--answer a:b has an empty value"],
        [["--apply", "--answer", "a:b=,HITL"], "--answer a:b has an empty value"],
        [
            ["--apply", "--answer", "a:b=HITL", "--answer", "a:b=AFK"],
            "--answer given more than once for a:b",
        ],
    ])("rejects %j", (argv, error) => {
        expect(parseArgs(argv)).toEqual({ ok: false, error });
    });
});
