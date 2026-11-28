import { describe, expect, it } from "vitest";

import { parseArgs, type RunArgs, USAGE } from "./args.ts";

const DEFAULTS: RunArgs = {
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
    transition: undefined,
    from: undefined,
    persist: undefined,
    pullRequest: undefined,
    title: undefined,
    log: undefined,
    publish: undefined,
    loop: false,
    grills: undefined,
    parallel: undefined,
    interval: undefined,
    notices: undefined,
    triageQuestions: false,
    stopLoop: false,
};

const REQUIRE_LOOP = "--grills, --parallel and --interval require --loop";
const LOOP_ONLY =
    "--loop can only be combined with --apply, --force, --json, --grills, --parallel and --interval";
const NOTICES_ALONE = "--notices cannot be combined with other flags";
const ACCOUNT_REMOVED =
    "--account is no longer accepted: the run evaluates the account Claude Code is logged in as";

function accepted(overrides: Partial<RunArgs>) {
    return { ok: true, args: { ...DEFAULTS, ...overrides } };
}

describe("parseArgs", () => {
    it("defaults to cached read, text output, no apply, no bootstrap and a handoff", () => {
        expect(parseArgs([])).toEqual(accepted({}));
    });

    it("reads every flag", () => {
        expect(parseArgs(["--force", "--json", "--apply"])).toEqual(
            accepted({ force: true, json: true, apply: true }),
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
        expect(parseArgs(["--force", "--json", "--apply", "--no-handoff"])).toEqual(
            accepted({ force: true, json: true, apply: true, noHandoff: true }),
        );
    });

    it("reads one --answer with --apply", () => {
        expect(parseArgs(["--apply", "--answer", "label-triage:beads:X-12:autonomy=HITL"])).toEqual(
            accepted({
                apply: true,
                answers: [{ id: "label-triage:beads:X-12:autonomy", values: ["HITL"] }],
            }),
        );
    });

    it("reads repeated --answer with --apply --json, splitting at the first = and then at commas", () => {
        expect(
            parseArgs([
                "--answer",
                "label-triage:github:owner/repo#12:autonomy=HITL,grill-me",
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
                    {
                        id: "label-triage:github:owner/repo#12:autonomy",
                        values: ["HITL", "grill-me"],
                    },
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

    it("reads --task with --force, --json, --apply and --no-handoff", () => {
        expect(
            parseArgs(["--task", "beads:X-12", "--force", "--json", "--apply", "--no-handoff"]),
        ).toEqual(
            accepted({
                task: { source: "beads", id: "X-12" },
                force: true,
                json: true,
                apply: true,
                noHandoff: true,
            }),
        );
    });

    it("reads --apply --transition", () => {
        expect(parseArgs(["--apply", "--transition", "linear:DOT-110"])).toEqual(
            accepted({ apply: true, transition: { source: "linear", id: "DOT-110" } }),
        );
    });

    it("reads --apply --transition with --json, splitting at the first colon", () => {
        expect(parseArgs(["--transition", "github:owner/repo#12", "--json", "--apply"])).toEqual(
            accepted({
                apply: true,
                json: true,
                transition: { source: "github", id: "owner/repo#12" },
            }),
        );
    });

    it("reads --apply --transition with --from and --json", () => {
        expect(
            parseArgs([
                "--apply",
                "--transition",
                "linear:DOT-110",
                "--from",
                "implement",
                "--json",
            ]),
        ).toEqual(
            accepted({
                apply: true,
                json: true,
                transition: { source: "linear", id: "DOT-110" },
                from: "implement",
            }),
        );
    });

    it("reads --apply --transition --from code-review", () => {
        expect(
            parseArgs(["--apply", "--transition", "linear:DOT-110", "--from", "code-review"]),
        ).toEqual(
            accepted({
                apply: true,
                transition: { source: "linear", id: "DOT-110" },
                from: "code-review",
            }),
        );
    });

    it("reads --apply --pull-request with and without --title and --json", () => {
        const id = "linear:DOT-121:grill-me:1";
        expect(parseArgs(["--apply", "--pull-request", id])).toEqual(
            accepted({ apply: true, pullRequest: id }),
        );
        expect(parseArgs(["--title", "Fix it", "--json", "--pull-request", id, "--apply"])).toEqual(
            accepted({ apply: true, json: true, pullRequest: id, title: "Fix it" }),
        );
    });

    it("reads --apply --log with and without --json", () => {
        const id = "linear:DOT-121:grill-me:1";
        expect(parseArgs(["--apply", "--log", id])).toEqual(accepted({ apply: true, log: id }));
        expect(parseArgs(["--log", id, "--json", "--apply"])).toEqual(
            accepted({ apply: true, json: true, log: id }),
        );
    });

    it("Publish mode: reads --apply --publish with and without --json", () => {
        const id = "linear:DOT-121:code-review:1";
        expect(parseArgs(["--apply", "--publish", id])).toEqual(
            accepted({ apply: true, publish: id }),
        );
        expect(parseArgs(["--publish", id, "--json", "--apply"])).toEqual(
            accepted({ apply: true, json: true, publish: id }),
        );
    });

    it("reads --apply --persist", () => {
        expect(parseArgs(["--apply", "--persist", "linear:DOT-121:grill-me:1"])).toEqual(
            accepted({ apply: true, persist: "linear:DOT-121:grill-me:1" }),
        );
    });

    it("reads --apply --persist with --json in any order", () => {
        expect(
            parseArgs(["--persist", "beads:agentic-task-x1:grill-me:2", "--json", "--apply"]),
        ).toEqual(
            accepted({ apply: true, json: true, persist: "beads:agentic-task-x1:grill-me:2" }),
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
        [["--bootstrap-labels", "--apply"], "--bootstrap-labels can only be combined with --json"],
        [["--bootstrap-labels", "--force"], "--bootstrap-labels can only be combined with --json"],
        [
            ["--json", "--bootstrap-labels", "--apply"],
            "--bootstrap-labels can only be combined with --json",
        ],
        [
            ["--bootstrap-labels", "--no-handoff"],
            "--no-handoff cannot be combined with --bootstrap-labels, --answer or --transition",
        ],
        [
            ["--apply", "--no-handoff", "--answer", "a:b=c"],
            "--no-handoff cannot be combined with --bootstrap-labels, --answer or --transition",
        ],
        [["--answer", "a:b=HITL"], "--answer requires --apply"],
        [["--json", "--answer", "a:b=HITL"], "--answer requires --apply"],
        [
            ["--apply", "--force", "--answer", "a:b=HITL"],
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
        [
            ["--task", "linear:A-1", "--stage", "external-review"],
            "--stage external-review is not a registered stage (test, grill-me, proposal, implement, verify, code-review)",
        ],
        [["--stage", "test"], "--stage requires --task"],
        [
            ["--task", "linear:A-1", "--bootstrap-labels"],
            "--task cannot be combined with --bootstrap-labels, --answer, --discard or --transition",
        ],
        [
            ["--task", "linear:A-1", "--apply", "--answer", "a:b=HITL"],
            "--task cannot be combined with --bootstrap-labels, --answer, --discard or --transition",
        ],
        [
            ["--task", "linear:A-1", "--apply", "--discard", "linear:A-1"],
            "--task cannot be combined with --bootstrap-labels, --answer, --discard or --transition",
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
        [["--apply", "--from", "verify"], "--from requires --transition"],
        [
            ["--apply", "--persist", "linear:DOT-121:verify:1", "--from", "verify"],
            "--from requires --transition",
        ],
        [["--apply", "--transition", "linear:DOT-110", "--from"], "--from requires a stage name"],
        [
            ["--apply", "--transition", "linear:DOT-110", "--from", "--json"],
            "--from requires a stage name",
        ],
        [
            ["--apply", "--transition", "linear:DOT-110", "--from", "external-review"],
            "--from external-review is not a stage a transition leaves (grill-me, proposal, implement, verify, code-review)",
        ],
        [
            ["--apply", "--transition", "linear:DOT-110", "--from", "verify", "--from", "verify"],
            "--from given more than once",
        ],
        [["--transition"], "--transition requires <source>:<id>"],
        [["--apply", "--transition"], "--transition requires <source>:<id>"],
        [["--apply", "--transition", "--json"], "--transition requires <source>:<id>"],
        [
            ["--apply", "--transition", "linear:A-1", "--transition", "linear:A-2"],
            "--transition given more than once",
        ],
        [
            ["--apply", "--transition", "DOT-110"],
            "--transition DOT-110 must be <source>:<id> with source linear, beads or github",
        ],
        [
            ["--apply", "--transition", "jira:DOT-110"],
            "--transition jira:DOT-110 must be <source>:<id> with source linear, beads or github",
        ],
        [
            ["--apply", "--transition", "linear:"],
            "--transition linear: must be <source>:<id> with source linear, beads or github",
        ],
        [["--transition", "linear:DOT-110"], "--transition requires --apply"],
        [["--transition", "linear:DOT-110", "--json"], "--transition requires --apply"],
        [
            ["--apply", "--transition", "linear:DOT-110", "--no-handoff"],
            "--no-handoff cannot be combined with --bootstrap-labels, --answer or --transition",
        ],
        [
            ["--apply", "--transition", "linear:DOT-110", "--answer", "a:b=HITL"],
            "--transition can only be combined with --apply, --from and --json",
        ],
        [
            ["--apply", "--transition", "linear:DOT-110", "--task", "linear:DOT-111"],
            "--task cannot be combined with --bootstrap-labels, --answer, --discard or --transition",
        ],
        [
            [
                "--apply",
                "--transition",
                "linear:DOT-110",
                "--task",
                "linear:DOT-111",
                "--stage",
                "test",
            ],
            "--task cannot be combined with --bootstrap-labels, --answer, --discard or --transition",
        ],
        [
            ["--apply", "--transition", "linear:DOT-110", "--discard", "beads:X-1"],
            "--transition can only be combined with --apply, --from and --json",
        ],
        [
            ["--apply", "--transition", "linear:DOT-110", "--bootstrap-labels"],
            "--bootstrap-labels can only be combined with --json",
        ],
        [
            ["--apply", "--transition", "linear:DOT-110", "--force"],
            "--transition can only be combined with --apply, --from and --json",
        ],
        [
            ["--apply", "--transition", "linear:DOT-110", "--release-workspace"],
            "--transition can only be combined with --apply, --from and --json",
        ],
        [["--apply", "--persist"], "--persist requires an attempt id <source>:<task>:<stage>:<n>"],
        [
            ["--apply", "--persist", "--json"],
            "--persist requires an attempt id <source>:<task>:<stage>:<n>",
        ],
        [
            ["--apply", "--persist", "linear:DOT-121"],
            "--persist linear:DOT-121 must be an attempt id <source>:<task>:<stage>:<n>",
        ],
        [
            ["--apply", "--persist", "linear:DOT-121:grill-me"],
            "--persist linear:DOT-121:grill-me must be an attempt id <source>:<task>:<stage>:<n>",
        ],
        [
            ["--apply", "--persist", "linear:DOT-121:grill-me:0"],
            "--persist linear:DOT-121:grill-me:0 must be an attempt id <source>:<task>:<stage>:<n>",
        ],
        [
            ["--apply", "--persist", "linear:DOT-121:grill-me:x"],
            "--persist linear:DOT-121:grill-me:x must be an attempt id <source>:<task>:<stage>:<n>",
        ],
        [
            ["--apply", "--persist", "jira:DOT-121:grill-me:1"],
            "--persist jira:DOT-121:grill-me:1 must be an attempt id <source>:<task>:<stage>:<n>",
        ],
        [
            ["--apply", "--persist", "linear:DOT-121:review:1"],
            "--persist linear:DOT-121:review:1 must be an attempt id <source>:<task>:<stage>:<n>",
        ],
        [
            [
                "--apply",
                "--persist",
                "linear:DOT-121:grill-me:1",
                "--persist",
                "beads:X-1:grill-me:1",
            ],
            "--persist given more than once",
        ],
        [["--persist", "linear:DOT-121:grill-me:1"], "--persist requires --apply"],
        [["--persist", "linear:DOT-121:grill-me:1", "--json"], "--persist requires --apply"],
        [
            ["--apply", "--persist", "linear:DOT-121:grill-me:1", "--force"],
            "--persist can only be combined with --apply and --json",
        ],
        [
            ["--apply", "--persist", "linear:DOT-121:grill-me:1", "--no-handoff"],
            "--persist can only be combined with --apply and --json",
        ],
        [
            ["--apply", "--persist", "linear:DOT-121:grill-me:1", "--bootstrap-labels"],
            "--bootstrap-labels can only be combined with --json",
        ],
        [
            ["--apply", "--persist", "linear:DOT-121:grill-me:1", "--transition", "linear:DOT-121"],
            "--transition can only be combined with --apply, --from and --json",
        ],
        [
            ["--apply", "--persist", "linear:DOT-121:grill-me:1", "--answer", "a:b=HITL"],
            "--persist can only be combined with --apply and --json",
        ],
        [
            ["--apply", "--persist", "linear:DOT-121:grill-me:1", "--task", "linear:DOT-121"],
            "--persist can only be combined with --apply and --json",
        ],
        [
            ["--apply", "--persist", "linear:DOT-121:grill-me:1", "--discard", "beads:X-1"],
            "--persist can only be combined with --apply and --json",
        ],
        [
            ["--apply", "--persist", "linear:DOT-121:grill-me:1", "--release-workspace"],
            "--persist can only be combined with --apply and --json",
        ],
        [
            ["--apply", "--pull-request", "linear:DOT-121"],
            "--pull-request linear:DOT-121 must be an attempt id <source>:<task>:<stage>:<n>",
        ],
        [
            ["--apply", "--log", "linear:DOT-121:review:1"],
            "--log linear:DOT-121:review:1 must be an attempt id <source>:<task>:<stage>:<n>",
        ],
        [
            [
                "--apply",
                "--pull-request",
                "linear:DOT-121:grill-me:1",
                "--pull-request",
                "linear:DOT-121:grill-me:1",
            ],
            "--pull-request given more than once",
        ],
        [["--pull-request", "linear:DOT-121:grill-me:1"], "--pull-request requires --apply"],
        [["--log", "linear:DOT-121:grill-me:1"], "--log requires --apply"],
        [["--apply", "--title", "Fix it"], "--title requires --pull-request"],
        [
            ["--apply", "--pull-request", "linear:DOT-121:grill-me:1", "--title", "  "],
            "--title requires a title",
        ],
        [
            ["--apply", "--pull-request", "linear:DOT-121:grill-me:1", "--title", "--json"],
            "--title requires a title",
        ],
        [
            [
                "--apply",
                "--pull-request",
                "linear:DOT-121:grill-me:1",
                "--title",
                "a",
                "--title",
                "b",
            ],
            "--title given more than once",
        ],
        [
            [
                "--apply",
                "--pull-request",
                "linear:DOT-121:grill-me:1",
                "--persist",
                "linear:DOT-121:grill-me:1",
            ],
            "--persist can only be combined with --apply and --json",
        ],
        [
            [
                "--apply",
                "--pull-request",
                "linear:DOT-121:grill-me:1",
                "--transition",
                "linear:DOT-121",
            ],
            "--transition can only be combined with --apply, --from and --json",
        ],
        [
            ["--apply", "--pull-request", "linear:DOT-121:grill-me:1", "--discard", "beads:X-1"],
            "--pull-request can only be combined with --apply, --title and --json",
        ],
        [
            [
                "--apply",
                "--log",
                "linear:DOT-121:grill-me:1",
                "--pull-request",
                "linear:DOT-121:grill-me:1",
            ],
            "--pull-request can only be combined with --apply, --title and --json",
        ],
        [
            [
                "--apply",
                "--log",
                "linear:DOT-121:grill-me:1",
                "--persist",
                "linear:DOT-121:grill-me:1",
            ],
            "--persist can only be combined with --apply and --json",
        ],
        [
            ["--apply", "--log", "linear:DOT-121:grill-me:1", "--title", "x"],
            "--title requires --pull-request",
        ],
        [["--release-workspace"], "--release-workspace requires --discard"],
        [["--apply", "--release-workspace"], "--release-workspace requires --discard"],
        [["--parallel", "3"], REQUIRE_LOOP],
        [["--apply", "--grills", "1"], REQUIRE_LOOP],
        [["--interval", "5"], REQUIRE_LOOP],
        [["--loop", "--task", "linear:DOT-120"], LOOP_ONLY],
        [["--loop", "--no-handoff"], LOOP_ONLY],
        [["--loop", "--bootstrap-labels"], LOOP_ONLY],
        [["--loop", "--apply", "--answer", "a:b=HITL"], LOOP_ONLY],
        [["--loop", "--apply", "--discard", "beads:X-1"], LOOP_ONLY],
        [["--loop", "--apply", "--transition", "linear:DOT-121"], LOOP_ONLY],
        [["--loop", "--apply", "--persist", "linear:DOT-121:grill-me:1"], LOOP_ONLY],
        [["--loop", "--apply", "--pull-request", "linear:DOT-121:grill-me:1"], LOOP_ONLY],
        [["--loop", "--apply", "--log", "linear:DOT-121:grill-me:1"], LOOP_ONLY],
        [["--loop", "--interval", "0"], "--interval 0 must be an integer of 1 or more"],
        [["--loop", "--interval", "2.5"], "--interval requires an integer of 1 or more"],
        [["--loop", "--interval", "-3"], "--interval requires an integer of 1 or more"],
        [["--loop", "--interval", "soon"], "--interval requires an integer of 1 or more"],
        [["--loop", "--interval"], "--interval requires an integer of 1 or more"],
        [["--loop", "--interval", "--apply"], "--interval requires an integer of 1 or more"],
        [["--loop", "--parallel", "-1"], "--parallel requires an integer of 0 or more"],
        [["--loop", "--grills", "1.5"], "--grills requires an integer of 0 or more"],
        [["--loop", "--grills", "1", "--grills", "2"], "--grills given more than once"],
        [["--notices"], "--notices requires an integer of 0 or more"],
        [["--notices", "-1"], "--notices requires an integer of 0 or more"],
        [["--notices", "0", "--loop"], NOTICES_ALONE],
        [["--notices", "0", "--apply"], NOTICES_ALONE],
        [["--notices", "0", "--json"], NOTICES_ALONE],
        [["--notices", "0", "--force"], NOTICES_ALONE],
        [["--notices", "0", "--task", "linear:DOT-120"], NOTICES_ALONE],
        [["--notices", "0", "--bootstrap-labels"], NOTICES_ALONE],
        [["--notices", "0", "--no-handoff"], NOTICES_ALONE],
        [["--notices", "0", "--loop", "--interval", "5"], NOTICES_ALONE],
        [["--apply", "--notices", "0", "--persist", "linear:DOT-121:grill-me:1"], NOTICES_ALONE],
        [["--apply", "--notices", "0", "--log", "linear:DOT-121:grill-me:1"], NOTICES_ALONE],
        [["--publish", "linear:DOT-121:code-review:1"], "--publish requires --apply"],
        [["--publish", "linear:DOT-121:code-review:1", "--json"], "--publish requires --apply"],
        [["--apply", "--publish"], "--publish requires an attempt id <source>:<task>:<stage>:<n>"],
        [
            ["--apply", "--publish", "linear:DOT-121"],
            "--publish linear:DOT-121 must be an attempt id <source>:<task>:<stage>:<n>",
        ],
        [
            [
                "--apply",
                "--publish",
                "linear:DOT-121:code-review:1",
                "--publish",
                "linear:DOT-121:code-review:1",
            ],
            "--publish given more than once",
        ],
        [
            ["--apply", "--publish", "linear:DOT-121:code-review:1", "--force"],
            "--publish can only be combined with --apply and --json",
        ],
        [
            ["--apply", "--publish", "linear:DOT-121:code-review:1", "--discard", "beads:X-1"],
            "--publish can only be combined with --apply and --json",
        ],
        [
            [
                "--apply",
                "--publish",
                "linear:DOT-121:code-review:1",
                "--log",
                "linear:DOT-121:code-review:1",
            ],
            "--log can only be combined with --apply and --json",
        ],
        [
            ["--apply", "--publish", "linear:DOT-121:code-review:1", "--title", "x"],
            "--title requires --pull-request",
        ],
        [["--loop", "--apply", "--publish", "linear:DOT-121:code-review:1"], LOOP_ONLY],
        [["--apply", "--notices", "0", "--publish", "linear:DOT-121:code-review:1"], NOTICES_ALONE],
    ])("rejects %j", (argv, error) => {
        expect(parseArgs(argv)).toEqual({ ok: false, error });
    });
});

describe("parseArgs --account", () => {
    it.each([
        [["--account", "ana@example.com"]],
        [["--account"]],
        [["--account", "--json"]],
        [["--account", "a@example.com", "--account", "b@example.com"]],
        [["--loop", "--apply", "--account", "claude@1a2b3c4d"]],
        [["--task", "beads:agentic-task-2x0", "--account", "ana@example.com"]],
        [["--account", "ana@example.com", "--stage", "test"]],
        [["--bootstrap-labels", "--account", "ana@example.com"]],
        [["--apply", "--answer", "a:b=HITL", "--account", "ana@example.com"]],
        [["--apply", "--discard", "beads:X-1", "--account", "ana@example.com"]],
        [["--notices", "0", "--account", "ana@example.com"]],
        [["--stop-loop", "--account", "ana@example.com"]],
        [["--triage-questions", "--account", "ana@example.com"]],
        [["--parallel", "3", "--account", "ana@example.com"]],
    ])("rejects %j with the removal message", (argv) => {
        expect(parseArgs(argv)).toEqual({ ok: false, error: ACCOUNT_REMOVED });
    });

    it("leaves --account out of the usage text", () => {
        expect(USAGE).not.toContain("--account");
        expect(USAGE).not.toContain("provider-key");
    });
});

describe("parseArgs loop flags", () => {
    it("reads --loop alone as a dry iteration", () => {
        expect(parseArgs(["--loop"])).toEqual(accepted({ loop: true }));
    });

    it("reads --loop with every flag it accepts", () => {
        expect(
            parseArgs([
                "--loop",
                "--apply",
                "--force",
                "--json",
                "--grills",
                "0",
                "--parallel",
                "3",
                "--interval",
                "30",
            ]),
        ).toEqual(
            accepted({
                loop: true,
                apply: true,
                force: true,
                json: true,
                grills: 0,
                parallel: 3,
                interval: 30,
            }),
        );
    });

    it("accepts --force with --loop", () => {
        expect(parseArgs(["--loop", "--force"])).toEqual(accepted({ loop: true, force: true }));
    });

    it("accepts --grills 0 and --parallel 0", () => {
        expect(parseArgs(["--loop", "--grills", "0", "--parallel", "0"])).toEqual(
            accepted({ loop: true, grills: 0, parallel: 0 }),
        );
    });

    it("reads --notices alone", () => {
        expect(parseArgs(["--notices", "0"])).toEqual(accepted({ notices: 0 }));
        expect(parseArgs(["--notices", "12"])).toEqual(accepted({ notices: 12 }));
    });

    it("names the loop in the usage text", () => {
        expect(USAGE).toContain("/autonomous:loop [");
        expect(USAGE).not.toContain("/autonomous:run --loop");
        expect(USAGE).not.toContain("/autonomous:run --notices");
        expect(USAGE).toContain("--notices <n>");
    });
});

describe("parseArgs --triage-questions", () => {
    const TRIAGE_ONLY = "--triage-questions can only be combined with --json";

    it("reads --triage-questions alone", () => {
        expect(parseArgs(["--triage-questions"])).toEqual(accepted({ triageQuestions: true }));
    });

    it("reads --triage-questions combined with --json", () => {
        expect(parseArgs(["--json", "--triage-questions"])).toEqual(
            accepted({ triageQuestions: true, json: true }),
        );
    });

    it.each([
        [["--triage-questions", "--apply"]],
        [["--triage-questions", "--task", "linear:DOT-120"]],
        [["--triage-questions", "--force"]],
        [["--triage-questions", "--loop"]],
        [["--triage-questions", "--answer", "linear:DOT-1:scope=personal"]],
        [["--apply", "--triage-questions", "--answer", "linear:DOT-1:scope=personal"]],
        [["--triage-questions", "--no-handoff"]],
        [["--triage-questions", "--bootstrap-labels"]],
        [["--triage-questions", "--notices", "0"]],
        [["--triage-questions", "--stage", "grill-me", "--task", "linear:DOT-120"]],
        [["--apply", "--triage-questions", "--discard", "linear:DOT-120"]],
        [["--loop", "--triage-questions", "--grills", "1"]],
        [["--apply", "--transition", "linear:DOT-110", "--triage-questions"]],
    ])("rejects %j", (argv) => {
        expect(parseArgs(argv)).toEqual({ ok: false, error: TRIAGE_ONLY });
    });

    it("names the mode in the usage text", () => {
        expect(USAGE).toContain("/autonomous:run --triage-questions [--json]");
    });
});

describe("parseArgs --stop-loop", () => {
    const STOP_ALONE = "--stop-loop cannot be combined with other flags";

    it("reads --stop-loop alone", () => {
        expect(parseArgs(["--stop-loop"])).toEqual(accepted({ stopLoop: true }));
    });

    it.each([
        [["--stop-loop", "--apply"]],
        [["--stop-loop", "--json"]],
        [["--stop-loop", "--loop"]],
        [["--stop-loop", "--notices", "0"]],
        [["--notices", "0", "--stop-loop"]],
        [["--stop-loop", "--force"]],
        [["--stop-loop", "--task", "linear:DOT-120"]],
        [["--stop-loop", "--triage-questions"]],
        [["--stop-loop", "--loop", "--interval", "5"]],
        [["--apply", "--stop-loop", "--persist", "linear:DOT-121:grill-me:1"]],
    ])("rejects %j", (argv) => {
        expect(parseArgs(argv)).toEqual({ ok: false, error: STOP_ALONE });
    });

    it("names the mode in the usage text", () => {
        expect(USAGE).toContain("run.ts --stop-loop");
    });
});
