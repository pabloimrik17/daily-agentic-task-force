import { describe, expect, it } from "vitest";

import { parseArgs, type RunArgs } from "./args.ts";

const DEFAULTS: RunArgs = {
    account: undefined,
    task: undefined,
    stage: undefined,
    discard: undefined,
    releaseWorkspace: false,
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

    it("reads --task alone", () => {
        expect(parseArgs(["--task", "linear:DOT-109"])).toEqual(
            accepted({ task: { source: "linear", id: "DOT-109" } }),
        );
    });

    it("reads --task --stage, splitting at the first colon", () => {
        expect(parseArgs(["--task", "github:owner/repo#12", "--stage", "test"])).toEqual(
            accepted({ task: { source: "github", id: "owner/repo#12" }, stage: "test" }),
        );
    });

    it("reads --task with --account, --force, --json, --apply and --no-handoff", () => {
        expect(
            parseArgs([
                "--task",
                "beads:X-12",
                "--account",
                "claude",
                "--force",
                "--json",
                "--apply",
                "--no-handoff",
            ]),
        ).toEqual(
            accepted({
                task: { source: "beads", id: "X-12" },
                account: "claude",
                force: true,
                json: true,
                apply: true,
                noHandoff: true,
            }),
        );
    });

    it("reads --apply --discard with an attempt id or a task reference", () => {
        expect(parseArgs(["--apply", "--discard", "linear:DOT-109:test:1"])).toEqual(
            accepted({ apply: true, discard: "linear:DOT-109:test:1" }),
        );
        expect(parseArgs(["--discard", "linear:DOT-109", "--apply"])).toEqual(
            accepted({ apply: true, discard: "linear:DOT-109" }),
        );
    });

    it("reads --apply --discard with --json and --release-workspace", () => {
        expect(
            parseArgs(["--apply", "--discard", "beads:X-12", "--json", "--release-workspace"]),
        ).toEqual(
            accepted({
                apply: true,
                json: true,
                discard: "beads:X-12",
                releaseWorkspace: true,
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
        [["--task"], "--task requires <source>:<id>"],
        [["--task", "--json"], "--task requires <source>:<id>"],
        [["--task", "linear:A-1", "--task", "linear:A-2"], "--task given more than once"],
        [
            ["--task", "DOT-109"],
            "--task DOT-109 must be <source>:<id> with source linear, beads or github",
        ],
        [
            ["--task", "jira:DOT-109"],
            "--task jira:DOT-109 must be <source>:<id> with source linear, beads or github",
        ],
        [
            ["--task", "linear:"],
            "--task linear: must be <source>:<id> with source linear, beads or github",
        ],
        [["--task", "linear:A-1", "--stage"], "--stage requires a stage name"],
        [["--task", "linear:A-1", "--stage", "--json"], "--stage requires a stage name"],
        [["--task", "linear:A-1", "--stage", ""], "--stage requires a stage name"],
        [
            ["--task", "linear:A-1", "--stage", "test", "--stage", "other"],
            "--stage given more than once",
        ],
        [["--stage", "test"], "--stage requires --task"],
        [
            ["--task", "linear:A-1", "--bootstrap-labels"],
            "--task cannot be combined with --bootstrap-labels, --answer or --discard",
        ],
        [
            ["--task", "linear:A-1", "--apply", "--answer", "a:b=HITL"],
            "--task cannot be combined with --bootstrap-labels, --answer or --discard",
        ],
        [
            ["--task", "linear:A-1", "--apply", "--discard", "linear:A-1"],
            "--task cannot be combined with --bootstrap-labels, --answer or --discard",
        ],
        [["--discard"], "--discard requires an attempt id or <source>:<id>"],
        [["--discard", "--apply"], "--discard requires an attempt id or <source>:<id>"],
        [["--discard", ""], "--discard requires an attempt id or <source>:<id>"],
        [
            ["--apply", "--discard", "beads:X-1", "--discard", "beads:X-2"],
            "--discard given more than once",
        ],
        [["--discard", "beads:X-1"], "--discard requires --apply"],
        [
            ["--apply", "--discard", "beads:X-1", "--account", "claude"],
            "--discard can only be combined with --apply, --json and --release-workspace",
        ],
        [
            ["--apply", "--discard", "beads:X-1", "--force"],
            "--discard can only be combined with --apply, --json and --release-workspace",
        ],
        [
            ["--apply", "--discard", "beads:X-1", "--no-handoff"],
            "--discard can only be combined with --apply, --json and --release-workspace",
        ],
        [
            ["--apply", "--discard", "beads:X-1", "--answer", "a:b=HITL"],
            "--discard can only be combined with --apply, --json and --release-workspace",
        ],
        [["--stage", "test", "--apply", "--discard", "beads:X-1"], "--stage requires --task"],
        [["--release-workspace"], "--release-workspace requires --discard"],
        [["--apply", "--release-workspace"], "--release-workspace requires --discard"],
    ])("rejects %j", (argv, error) => {
        expect(parseArgs(argv)).toEqual({ ok: false, error });
    });
});
