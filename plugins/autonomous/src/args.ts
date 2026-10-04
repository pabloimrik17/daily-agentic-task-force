// One answer passed back to a question of a handoff: the question's id and the
// option values chosen for it (design D3).
export interface Answer {
    id: string;
    values: string[];
}

export interface RunArgs {
    account: string | undefined;
    force: boolean;
    json: boolean;
    apply: boolean;
    bootstrapLabels: boolean;
    noHandoff: boolean;
    answers: Answer[];
}

export type ParseArgsResult = { ok: true; args: RunArgs } | { ok: false; error: string };

export const USAGE = [
    "Usage: /autonomous:run [--account <provider-key>] [--force] [--json] [--apply] [--no-handoff]",
    "       /autonomous:run --bootstrap-labels [--json]",
    "       /autonomous:run --apply --answer <id>=<value>[,<value>]... [--json]",
].join("\n");

const ANSWER_SHAPE = "--answer requires <id>=<value>[,<value>]";

// Flags that take no value.
const SWITCHES = new Map<string, (args: RunArgs) => void>([
    ["--force", (args) => (args.force = true)],
    ["--json", (args) => (args.json = true)],
    ["--apply", (args) => (args.apply = true)],
    ["--bootstrap-labels", (args) => (args.bootstrapLabels = true)],
    ["--no-handoff", (args) => (args.noHandoff = true)],
]);

// Flags that take the next argument as their value; each returns an error or null.
const VALUED = new Map<string, (args: RunArgs, value: string | undefined) => string | null>([
    ["--account", readAccount],
    ["--answer", readAnswer],
]);

export function parseArgs(argv: readonly string[]): ParseArgsResult {
    const args: RunArgs = {
        account: undefined,
        force: false,
        json: false,
        apply: false,
        bootstrapLabels: false,
        noHandoff: false,
        answers: [],
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

const answering = (args: RunArgs) => args.answers.length > 0;
const accountOrForce = (args: RunArgs) => args.account !== undefined || args.force;

// Flag combinations that are usage errors, checked in order.
const COMBINATIONS: readonly (readonly [(args: RunArgs) => boolean, string])[] = [
    [
        (args) => args.noHandoff && (args.bootstrapLabels || answering(args)),
        "--no-handoff cannot be combined with --bootstrap-labels or --answer",
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
