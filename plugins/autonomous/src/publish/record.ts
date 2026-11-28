// The record of a stage's findings, `findings.json` (spec finding-threads, "The record of the
// findings" and "An invalid record publishes nothing"; design D7). The agent writes it; publish
// mode refuses the whole record, naming every entry and field at fault, before it posts anything.

import { parseAttemptId } from "../attempts/record.ts";
import type { Result } from "../result.ts";
import { skippedReviewer } from "../review-team/plan-file.ts";
import { integerAtLeast, location, nonEmpty, oneLine } from "../review-team/schema.ts";
import {
    type Location,
    REVIEWER_IDS,
    SEVERITIES,
    type Severity,
    type SkippedReviewer,
    type Tier,
    TIERS,
} from "../review-team/types.ts";
import {
    array,
    choice,
    type Json,
    object,
    optional,
    ParseError,
    rejectUnknownKeys,
    string,
    stringArray,
} from "../validate.ts";

export const FINDINGS_SCHEMA = "autonomous.findings.v1";

const REPORTERS = [...REVIEWER_IDS, "verification", "human"] as const;

interface EntryReporter {
    // One of REPORTERS, or a reporter the caller adds: an external review's `ci` and review bots.
    reviewer: string;
    ids: string[];
    engine?: string;
}

const FINDING_DESTINATIONS = ["fix", "pass-on", "defer", "dismiss"] as const;
const DOUBT_DESTINATIONS = ["settled", "ask", "publish"] as const;
type FindingDestination = (typeof FINDING_DESTINATIONS)[number];
type DoubtDestination = (typeof DOUBT_DESTINATIONS)[number];

const OUTCOMES = ["survived", "refuted", "not-refuted"] as const;

interface Refutation {
    outcome: (typeof OUTCOMES)[number];
    reproduction: string | null;
}

type Publication =
    | { state: "fixed"; commit: string }
    | { state: "deferred"; followUp: string } // the follow-up task was created
    | { state: "deferred"; proposedTitle: string } // the follow-up task was only proposed
    | { state: "passed-on"; stage: string }
    | { state: "blocked"; reason: string }
    | { state: "asked" } // a doubt the human answered
    | { state: "none" };

export type PublicationState = Publication["state"];

const PUBLICATION_STATES = [
    "fixed",
    "deferred",
    "passed-on",
    "blocked",
    "asked",
    "none",
] as const satisfies readonly PublicationState[];

interface EntryBase {
    id: string;
    round: number; // 1 is the stage's round; 2.. are human rounds
    reporters: EntryReporter[];
    title: string;
    statement: string;
    location: Location;
    reason: string;
    publication: Publication;
    thread: string | null; // the node id of the existing thread this entry continues
}

export interface FindingEntry extends EntryBase {
    kind: "finding";
    severity: Severity;
    label: "issue" | "suggestion";
    destination: FindingDestination;
    refutation: Refutation;
}

export interface DoubtEntry extends EntryBase {
    kind: "doubt";
    destination: DoubtDestination;
}

export type RecordEntry = FindingEntry | DoubtEntry;

export interface FindingsRecord {
    schema: typeof FINDINGS_SCHEMA;
    attempt: string;
    review: { tier: Tier; skipped: SkippedReviewer[] }; // the review team run of the stage's round
    entries: RecordEntry[];
    quiet?: true; // an external review's quiet round (design D12 of add-external-review-stage)
}

export interface RecordOptions {
    reporters?: readonly string[]; // accepted beside REPORTERS
}

type FieldReader = (parent: Json, path: string) => unknown;

const ID = /^[\w.-]+$/u;
const COMMIT = /^[0-9a-f]{7,40}$/u;
const STAGE = /^[a-z][a-z0-9-]*$/u;
const HTTP_URL = /^https?:\/\/\S+$/u;

function matching(parent: Json, key: string, path: string, pattern: RegExp, what: string): string {
    const value = string(parent, key, path);
    if (!pattern.test(value)) {
        throw new ParseError(`${path}.${key} must be ${what} (got ${JSON.stringify(value)})`);
    }
    return value;
}

// The pattern keeps the scheme to HTTP; the parse refuses what no host can be read from.
function httpUrl(parent: Json, key: string, path: string): string {
    const value = matching(parent, key, path, HTTP_URL, "a URL");
    if (!URL.canParse(value)) {
        throw new ParseError(`${path}.${key} must be a URL (got ${JSON.stringify(value)})`);
    }
    return value;
}

function statement(parent: Json, path: string): string {
    const value = nonEmpty(parent, "statement", path);
    if (value.split(/\r?\n/u).length > 3) {
        throw new ParseError(`${path}.statement must hold one to three lines`);
    }
    return value;
}

function reporter(value: unknown, path: string, allowed: readonly string[]): EntryReporter {
    const parent = object(value, path);
    rejectUnknownKeys(parent, ["reviewer", "ids", "engine"], path);
    const engine = optional(parent, "engine", path, nonEmpty);
    return {
        reviewer: choice(parent, "reviewer", path, allowed),
        ids: stringArray(parent, "ids", path),
        ...(engine === undefined ? {} : { engine }),
    };
}

function reporters(parent: Json, path: string, allowed: readonly string[]): EntryReporter[] {
    const values = array(parent.reporters, `${path}.reporters`);
    if (values.length === 0) {
        throw new ParseError(`${path}.reporters must name at least one reporter`);
    }
    return values.map((value, index) => reporter(value, `${path}.reporters[${index}]`, allowed));
}

function thread(parent: Json, path: string): string | null {
    if (!("thread" in parent)) {
        throw new ParseError(`${path}.thread must be a string or null`);
    }
    return parent.thread === null ? null : nonEmpty(parent, "thread", path);
}

function refutation(parent: Json, path: string): Refutation {
    const value = object(parent.refutation, `${path}.refutation`);
    const at = `${path}.refutation`;
    rejectUnknownKeys(value, ["outcome", "reproduction"], at);
    if (!("reproduction" in value)) {
        throw new ParseError(`${at}.reproduction must be a string or null`);
    }
    return {
        outcome: choice(value, "outcome", at, OUTCOMES),
        reproduction: value.reproduction === null ? null : nonEmpty(value, "reproduction", at),
    };
}

const PUBLICATION_READERS: Readonly<
    Record<PublicationState, (value: Json, path: string) => Publication>
> = {
    fixed: (value, path) => {
        rejectUnknownKeys(value, ["state", "commit"], path);
        return { state: "fixed", commit: matching(value, "commit", path, COMMIT, "a commit id") };
    },
    deferred: deferred,
    "passed-on": (value, path) => {
        rejectUnknownKeys(value, ["state", "stage"], path);
        return { state: "passed-on", stage: matching(value, "stage", path, STAGE, "a stage id") };
    },
    blocked: (value, path) => {
        rejectUnknownKeys(value, ["state", "reason"], path);
        return { state: "blocked", reason: oneLine(value, "reason", path) };
    },
    asked: (value, path) => {
        rejectUnknownKeys(value, ["state"], path);
        return { state: "asked" };
    },
    none: (value, path) => {
        rejectUnknownKeys(value, ["state"], path);
        return { state: "none" };
    },
};

// Follow-up references are explicit URLs (spec "The comment format").
function deferred(value: Json, path: string): Publication {
    if ("followUp" in value) {
        rejectUnknownKeys(value, ["state", "followUp"], path);
        return {
            state: "deferred",
            followUp: httpUrl(value, "followUp", path),
        };
    }
    rejectUnknownKeys(value, ["state", "proposedTitle"], path);
    return { state: "deferred", proposedTitle: oneLine(value, "proposedTitle", path) };
}

function publication(parent: Json, path: string): Publication {
    const at = `${path}.publication`;
    const value = object(parent.publication, at);
    return PUBLICATION_READERS[choice(value, "state", at, PUBLICATION_STATES)](value, at);
}

const COMMON_READERS: Readonly<Record<string, FieldReader>> = {
    id: (parent, path) => matching(parent, "id", path, ID, "made of [A-Za-z0-9._-]"),
    round: (parent, path) => integerAtLeast(parent, "round", path, 1),
    kind: (parent, path) => choice(parent, "kind", path, ["finding", "doubt"]),
    reporters: (parent, path) => reporters(parent, path, REPORTERS),
    title: (parent, path) => oneLine(parent, "title", path),
    statement,
    location: (parent, path) => location(parent.location, `${path}.location`),
    reason: (parent, path) => nonEmpty(parent, "reason", path),
    publication,
    thread,
};

const FINDING_READERS: Readonly<Record<string, FieldReader>> = {
    severity: (parent, path) => choice(parent, "severity", path, SEVERITIES),
    label: (parent, path) => choice(parent, "label", path, ["issue", "suggestion"]),
    refutation,
};

const ENTRY_KEYS = [...Object.keys(COMMON_READERS), ...Object.keys(FINDING_READERS), "destination"];

// Which publication states fit a destination and its refutation outcome (seam of the record;
// adversarial-review: a finding passed on or dismissed is not refuted).
const FITTING: Readonly<Record<string, readonly PublicationState[]>> = {
    "fix/survived": ["fixed", "blocked"],
    "fix/refuted": ["none"],
    "defer/survived": ["deferred"],
    "defer/refuted": ["none"],
    "pass-on/not-refuted": ["passed-on"],
    "dismiss/not-refuted": ["none"],
    settled: ["none"],
    ask: ["asked", "none"],
    publish: ["none"],
};

// Runs one check, keeping its error so that every fault of the record is reported together.
function check<T>(errors: string[], read: () => T): T | undefined {
    try {
        return read();
    } catch (error) {
        if (error instanceof ParseError) {
            errors.push(error.message);
            return undefined;
        }
        throw error;
    }
}

function readFields(
    parent: Json,
    path: string,
    readers: Readonly<Record<string, FieldReader>>,
    errors: string[],
): Record<string, unknown> {
    const fields: Record<string, unknown> = {};
    for (const [key, read] of Object.entries(readers)) {
        fields[key] = check(errors, () => read(parent, path));
    }
    return fields;
}

function kindFields(
    parent: Json,
    path: string,
    kind: unknown,
    errors: string[],
): Record<string, unknown> {
    if (kind === "finding") {
        return readFields(parent, path, FINDING_READERS, errors);
    }
    if (kind !== "doubt") {
        return {};
    }
    for (const key of Object.keys(FINDING_READERS).filter((name) => name in parent)) {
        errors.push(`${path}.${key}: a doubt carries no ${key}`);
    }
    return {};
}

function destination(parent: Json, path: string, kind: unknown): string {
    const allowed = kind === "doubt" ? DOUBT_DESTINATIONS : FINDING_DESTINATIONS;
    return choice<string>(parent, "destination", path, allowed);
}

function consistency(fields: Record<string, unknown>, path: string): string | undefined {
    const outcome = (fields.refutation as Refutation | undefined)?.outcome;
    const key =
        fields.kind === "doubt"
            ? String(fields.destination)
            : `${String(fields.destination)}/${outcome}`;
    const fitting = FITTING[key];
    if (fitting === undefined) {
        return `${path}.refutation.outcome ${JSON.stringify(outcome)} does not fit the destination ${JSON.stringify(fields.destination)}`;
    }
    const state = (fields.publication as Publication).state;
    return fitting.includes(state)
        ? undefined
        : `${path}.publication.state ${JSON.stringify(state)} does not fit ${key} (expected ${fitting.join(" or ")})`;
}

// The entry's path names its id when it has a usable one, so the report names the entry.
function entryPath(parent: Json, index: number): string {
    const id = parent.id;
    return typeof id === "string" && ID.test(id) ? `$.entries[${id}]` : `$.entries[${index}]`;
}

function entry(
    value: unknown,
    index: number,
    errors: string[],
    readers: Readonly<Record<string, FieldReader>>,
): RecordEntry | undefined {
    const parent = check(errors, () => object(value, `$.entries[${index}]`));
    if (parent === undefined) {
        return undefined;
    }
    const path = entryPath(parent, index);
    const before = errors.length;
    for (const key of Object.keys(parent)) {
        check(errors, () => rejectUnknownKeys({ [key]: null }, ENTRY_KEYS, path));
    }
    const fields = {
        ...readFields(parent, path, readers, errors),
        destination: check(errors, () => destination(parent, path, parent.kind)),
        ...kindFields(parent, path, parent.kind, errors),
    };
    if (errors.length > before) {
        return undefined;
    }
    const inconsistent = consistency(fields, path);
    if (inconsistent !== undefined) {
        errors.push(inconsistent);
        return undefined;
    }
    return fields as unknown as RecordEntry;
}

// Each field is checked by itself, so the report names every one at fault.
function review(value: unknown, errors: string[]): unknown {
    const parent = check(errors, () => object(value, "$.review"));
    if (parent === undefined) {
        return undefined;
    }
    check(errors, () => rejectUnknownKeys(parent, ["tier", "skipped"], "$.review"));
    const skipped = check(errors, () => array(parent.skipped, "$.review.skipped")) ?? [];
    return {
        tier: check(errors, () => choice(parent, "tier", "$.review", TIERS)),
        skipped: skipped.map((item, index) =>
            check(errors, () => skippedReviewer(item, `$.review.skipped[${index}]`)),
        ),
    };
}

function attemptId(parent: Json): string {
    const value = string(parent, "attempt", "$");
    if (parseAttemptId(value) === null) {
        throw new ParseError(`$.attempt must be an attempt id (got ${JSON.stringify(value)})`);
    }
    return value;
}

function duplicates(entries: RecordEntry[]): string[] {
    const seen = new Set<string>();
    const twice = new Set<string>();
    for (const { id } of entries) {
        (seen.has(id) ? twice : seen).add(id);
    }
    return [...twice].map((id) => `$.entries holds the id ${JSON.stringify(id)} more than once`);
}

function commonReaders(options: RecordOptions): Readonly<Record<string, FieldReader>> {
    const allowed = [...REPORTERS, ...(options.reporters ?? [])];
    return { ...COMMON_READERS, reporters: (parent, path) => reporters(parent, path, allowed) };
}

function entries(parent: Json, errors: string[], options: RecordOptions): RecordEntry[] {
    const values = check(errors, () => array(parent.entries, "$.entries")) ?? [];
    const readers = commonReaders(options);
    const read = values.map((value, index) => entry(value, index, errors, readers));
    const valid = read.filter((item): item is RecordEntry => item !== undefined);
    errors.push(...duplicates(valid));
    return valid;
}

// Spec finding-threads, "The record may mark a quiet round": only `true`, and only for an
// external review whose round sends nothing to fix. A refuted finding keeps the destination it
// was triaged to, so only a surviving one counts as sent to fix.
function quiet(parent: Json): true | undefined {
    if (!("quiet" in parent)) {
        return undefined;
    }
    if (parent.quiet !== true) {
        throw new ParseError("$.quiet must be true when present");
    }
    return true;
}

function quietFaults(value: { attempt?: string; entries: RecordEntry[] }): string[] {
    const stage = parseAttemptId(value.attempt ?? "")?.stage;
    if (stage !== undefined && stage !== "external-review") {
        return [`$.quiet marks an external review's quiet round, not a ${stage} attempt's record`];
    }
    return value.entries
        .filter(
            (item) =>
                item.kind === "finding" &&
                item.destination === "fix" &&
                item.refutation.outcome === "survived",
        )
        .map(({ id }) => `$.quiet marks a quiet round, but $.entries[${id}] is sent to fix`);
}

function record(
    input: unknown,
    errors: string[],
    options: RecordOptions,
): FindingsRecord | undefined {
    const parent = check(errors, () => object(input, "$"));
    if (parent === undefined) {
        return undefined;
    }
    const keys = ["schema", "attempt", "review", "entries", "quiet"];
    check(errors, () => rejectUnknownKeys(parent, keys, "$"));
    const value = {
        schema: check(errors, () => choice(parent, "schema", "$", [FINDINGS_SCHEMA])),
        attempt: check(errors, () => attemptId(parent)),
        review: review(parent.review, errors),
        entries: entries(parent, errors, options),
    };
    const marked = check(errors, () => quiet(parent));
    if (marked !== undefined) {
        errors.push(...quietFaults(value));
    }
    const read = marked === undefined ? value : { ...value, quiet: marked };
    return errors.length === 0 ? (read as FindingsRecord) : undefined;
}

// `file` names the record in the error, which lists every fault found.
export function parseFindingsRecord(
    text: string,
    file: string,
    options: RecordOptions = {},
): Result<FindingsRecord> {
    let input: unknown;
    try {
        input = JSON.parse(text);
    } catch (error) {
        return { ok: false, error: `${file} is not valid JSON: ${(error as Error).message}` };
    }
    const errors: string[] = [];
    const value = record(input, errors, options);
    return value === undefined
        ? { ok: false, error: `${file} is invalid: ${errors.join("; ")}` }
        : { ok: true, value };
}
