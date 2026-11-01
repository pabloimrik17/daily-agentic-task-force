import { parseTaskRef, type TaskRef } from "./attempts/record.ts";
import type { Source } from "./config.ts";
import { STAGES } from "./stages/registry.ts";
import { isStageId, type StageId } from "./stages/stage.ts";

// One answer passed back to a question of a handoff: the question's id and the
// option values chosen for it (design D3).
export interface Answer {
    id: string;
    values: string[];
}

export interface RunArgs {
    account: string | undefined;
    task: { source: Source; id: string } | undefined;
    stage: StageId | undefined; // only with --task
    discard: string | undefined; // an attempt id or <source>:<id>
    releaseWorkspace: boolean;
    force: boolean;
    json: boolean;
    apply: boolean;
    bootstrapLabels: boolean;
    noHandoff: boolean;
    answers: Answer[];
    transition: { source: Source; id: string } | undefined;
}

export type ParseArgsResult = { ok: true; args: RunArgs } | { ok: false; error: string };

export const USAGE = [
    "Usage: /autonomous:run [--account <provider-key>] [--force] [--json] [--apply] [--no-handoff]",
    "       /autonomous:run --bootstrap-labels [--json]",
    "       /autonomous:run --apply --answer <id>=<value>[,<value>]... [--json]",
    "       /autonomous:run --task <source>:<id> [--stage <stage>] [--account <provider-key>] [--force] [--json] [--apply] [--no-handoff]",
    "       /autonomous:run --apply --discard <attempt-id|source:id> [--release-workspace] [--json]",
    "       /autonomous:run --apply --transition <source>:<task> [--json]",
].join("\n");

const ANSWER_SHAPE = "--answer requires <id>=<value>[,<value>]";

// Flags that take no value.
const SWITCHES = new Map<string, (args: RunArgs) => void>([
    ["--force", (args) => (args.force = true)],
    ["--json", (args) => (args.json = true)],
    ["--apply", (args) => (args.apply = true)],
    ["--bootstrap-labels", (args) => (args.bootstrapLabels = true)],
    ["--no-handoff", (args) => (args.noHandoff = true)],
    ["--release-workspace", (args) => (args.releaseWorkspace = true)],
]);

// Flags that take the next argument as their value; each returns an error or null.
const VALUED = new Map<string, (args: RunArgs, value: string | undefined) => string | null>([
    ["--account", readAccount],
    ["--answer", readAnswer],
    ["--task", readTask],
    ["--stage", readStage],
    ["--discard", readDiscard],
    ["--transition", readTransition],
]);

export function parseArgs(argv: readonly string[]): ParseArgsResult {
    const args: RunArgs = {
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
        transition: undefined,
    };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i] ?? "";
        const toggle = SWITCHES.get(arg);
        if (toggle !== undefined) {
            toggle(args);
            continue;
        }
        const read = VALUED.get(arg);
        const error =
            read === undefined ? `unrecognised argument: ${arg}` : read(args, argv[i + 1]);
        if (error !== null) {
            return { ok: false, error };
        }
        i++;
    }
    const error = combinationError(args);
    return error === null ? { ok: true, args } : { ok: false, error };
}

function readAccount(args: RunArgs, value: string | undefined): string | null {
    if (value === undefined || value.startsWith("--")) {
        return "--account requires a provider key";
    }
    if (args.account !== undefined) {
        return "--account given more than once";
    }
    args.account = value;
    return null;
}

function readAnswer(args: RunArgs, value: string | undefined): string | null {
    const parsed = parseAnswer(value);
    if (!parsed.ok) {
        return parsed.error;
    }
    if (args.answers.some((answer) => answer.id === parsed.answer.id)) {
        return `--answer given more than once for ${parsed.answer.id}`;
    }
    args.answers.push(parsed.answer);
    return null;
}

function readTask(args: RunArgs, value: string | undefined): string | null {
    const read = readTaskRef("--task", args.task, value);
    if (!read.ok) {
        return read.error;
    }
    args.task = read.ref;
    return null;
}

function readTransition(args: RunArgs, value: string | undefined): string | null {
    const read = readTaskRef("--transition", args.transition, value);
    if (!read.ok) {
        return read.error;
    }
    args.transition = read.ref;
    return null;
}

// --task and --transition each take one <source>:<id>, given once.
function readTaskRef(
    flag: string,
    current: TaskRef | undefined,
    value: string | undefined,
): { ok: true; ref: TaskRef } | { ok: false; error: string } {
    if (value === undefined || value.startsWith("--")) {
        return { ok: false, error: `${flag} requires <source>:<id>` };
    }
    if (current !== undefined) {
        return { ok: false, error: `${flag} given more than once` };
    }
    const ref = parseTaskRef(value);
    if (ref === null) {
        return {
            ok: false,
            error: `${flag} ${value} must be <source>:<id> with source linear, beads or github`,
        };
    }
    return { ok: true, ref };
}

// The stage must be registered, so a typo is a usage error before any tracker is touched.
function readStage(args: RunArgs, value: string | undefined): string | null {
    if (value === undefined || value === "" || value.startsWith("--")) {
        return "--stage requires a stage name";
    }
    if (args.stage !== undefined) {
        return "--stage given more than once";
    }
    if (!isStageId(value) || !STAGES.has(value)) {
        return `--stage ${value} is not a registered stage (${[...STAGES.keys()].join(", ")})`;
    }
    args.stage = value;
    return null;
}

// Kept as a string: discard mode resolves it to an attempt or to a task's attempts.
function readDiscard(args: RunArgs, value: string | undefined): string | null {
    if (value === undefined || value === "" || value.startsWith("--")) {
        return "--discard requires an attempt id or <source>:<id>";
    }
    if (args.discard !== undefined) {
        return "--discard given more than once";
    }
    args.discard = value;
    return null;
}

const answering = (args: RunArgs) => args.answers.length > 0;
const transitioning = (args: RunArgs) => args.transition !== undefined;
const accountOrForce = (args: RunArgs) => args.account !== undefined || args.force;

// Every flag other than --apply and --json, for the modes that accept only those.
const otherFlags = (args: RunArgs) =>
    [
        accountOrForce(args),
        args.noHandoff,
        args.bootstrapLabels,
        answering(args),
        args.task !== undefined,
        args.stage !== undefined,
        args.discard !== undefined,
        args.releaseWorkspace,
    ].some(Boolean);

// Flag combinations that are usage errors, checked in order.
const COMBINATIONS: readonly (readonly [(args: RunArgs) => boolean, string])[] = [
    [
        (args) =>
            args.noHandoff && (args.bootstrapLabels || answering(args) || transitioning(args)),
        "--no-handoff cannot be combined with --bootstrap-labels, --answer or --transition",
    ],
    [
        (args) => args.bootstrapLabels && (accountOrForce(args) || args.apply || answering(args)),
        "--bootstrap-labels can only be combined with --json",
    ],
    [(args) => answering(args) && !args.apply, "--answer requires --apply"],
    [
        (args) => answering(args) && accountOrForce(args),
        "--answer can only be combined with --apply and --json",
    ],
    [(args) => args.stage !== undefined && args.task === undefined, "--stage requires --task"],
    [
        (args) =>
            args.task !== undefined &&
            (args.bootstrapLabels ||
                answering(args) ||
                args.discard !== undefined ||
                transitioning(args)),
        "--task cannot be combined with --bootstrap-labels, --answer, --discard or --transition",
    ],
    [(args) => args.discard !== undefined && !args.apply, "--discard requires --apply"],
    [
        (args) =>
            args.discard !== undefined &&
            (accountOrForce(args) || args.noHandoff || args.bootstrapLabels || answering(args)),
        "--discard can only be combined with --apply, --json and --release-workspace",
    ],
    [(args) => transitioning(args) && !args.apply, "--transition requires --apply"],
    [
        (args) => transitioning(args) && otherFlags(args),
        "--transition can only be combined with --apply and --json",
    ],
    [
        (args) => args.releaseWorkspace && args.discard === undefined,
        "--release-workspace requires --discard",
    ],
];

function combinationError(args: RunArgs): string | null {
    return COMBINATIONS.find(([broken]) => broken(args))?.[1] ?? null;
}

// The id and the values are split at the first `=`, the values at `,`.
function parseAnswer(
    raw: string | undefined,
): { ok: true; answer: Answer } | { ok: false; error: string } {
    if (raw === undefined || raw.startsWith("--")) {
        return { ok: false, error: ANSWER_SHAPE };
    }
    const equals = raw.indexOf("=");
    if (equals === -1) {
        return { ok: false, error: ANSWER_SHAPE };
    }
    const id = raw.slice(0, equals);
    if (id === "") {
        return { ok: false, error: `--answer ${raw} has an empty id` };
    }
    const values = raw.slice(equals + 1).split(",");
    if (values.some((value) => value === "")) {
        return { ok: false, error: `--answer ${id} has an empty value` };
    }
    return { ok: true, answer: { id, values } };
}
