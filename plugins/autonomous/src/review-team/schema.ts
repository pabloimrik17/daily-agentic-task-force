// The validators of `autonomous.finding.v1` (a reviewer's output file) and
// `autonomous.review-report.v1` (spec review-team, "The finding schema",
// "Doubts are reported apart", "Severity comes from fixed tables" and "Output
// is validated at run time"; design D3 and D4). They are strict and carry
// their path in every error, so a reviewer that wrote a wrong file is skipped
// with a reason that quotes it.

import type { Result } from "../result.ts";
import {
    array,
    boolean,
    type Json,
    number,
    object,
    optional,
    ParseError,
    rejectUnknownKeys,
    string,
    stringArray,
} from "../validate.ts";
import { deriveSeverity, SEVERITY_TABLES } from "./severity.ts";
import {
    type Doubt,
    type DroppedEntry,
    type Engine,
    type Finding,
    FINDING_SCHEMA,
    type Location,
    type Measure,
    type RawDoubt,
    type RawFinding,
    type RawItem,
    type Report,
    REPORT_SCHEMA,
    type Reporter,
    type ReviewerFile,
    type ReviewerId,
    REVIEWER_IDS,
    type ReviewerOutcome,
    SEVERITIES,
    type SecurityMatch,
    type Subject,
    type Tier,
    type TierChoice,
    TIERS,
    type WalkthroughGuide,
} from "./types.ts";

type Reader<T> = (value: unknown, path: string) => T;

export function toResult<T>(read: () => T): Result<T> {
    try {
        return { ok: true, value: read() };
    } catch (error) {
        if (error instanceof ParseError) {
            return { ok: false, error: error.message };
        }
        throw error;
    }
}

export function nonEmpty(parent: Json, key: string, path: string): string {
    const value = string(parent, key, path);
    if (value.trim() === "") {
        throw new ParseError(`${path}.${key} must not be empty`);
    }
    return value;
}

function oneLine(parent: Json, key: string, path: string): string {
    const value = nonEmpty(parent, key, path);
    if (/[\r\n]/.test(value)) {
        throw new ParseError(`${path}.${key} must be a single line`);
    }
    return value;
}

export function choice<T extends string>(
    parent: Json,
    key: string,
    path: string,
    allowed: readonly T[],
): T {
    const value = string(parent, key, path);
    if (!(allowed as readonly string[]).includes(value)) {
        throw new ParseError(
            `${path}.${key} must be one of ${allowed.join(", ")} (got ${JSON.stringify(value)})`,
        );
    }
    return value as T;
}

function integerAtLeast(parent: Json, key: string, path: string, minimum: number): number {
    const value = number(parent, key, path);
    if (!Number.isInteger(value) || value < minimum) {
        throw new ParseError(`${path}.${key} must be an integer >= ${minimum}`);
    }
    return value;
}

const UNSAFE_PATH: ReadonlyArray<(value: string) => boolean> = [
    (value) => value.startsWith("/") || /^[a-z]:/i.test(value),
    (value) => value.includes("\\"),
    (value) => value.split("/").includes(".."),
];

function relativePath(parent: Json, key: string, path: string): string {
    const value = nonEmpty(parent, key, path);
    if (UNSAFE_PATH.some((unsafe) => unsafe(value))) {
        throw new ParseError(
            `${path}.${key} must be relative, with forward slashes and no ".." segment (got ${JSON.stringify(value)})`,
        );
    }
    return value;
}

function list<T>(parent: Json, key: string, path: string, read: Reader<T>): T[] {
    return array(parent[key], `${path}.${key}`).map((entry, index) =>
        read(entry, `${path}.${key}[${index}]`),
    );
}

function field<T>(read: Reader<T>): (parent: Json, key: string, path: string) => T {
    return (parent, key, path) => read(parent[key], `${path}.${key}`);
}

function withOptional<K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } {
    return (value === undefined ? {} : { [key]: value }) as { [P in K]?: V };
}

const SCOPES = ["line", "file", "change"] as const;

function lineLocation(parent: Json, path: string): Location {
    rejectUnknownKeys(parent, ["scope", "file", "startLine", "endLine", "side"], path);
    const startLine = integerAtLeast(parent, "startLine", path, 1);
    const endLine = integerAtLeast(parent, "endLine", path, 1);
    if (endLine < startLine) {
        throw new ParseError(`${path}.endLine must be >= startLine`);
    }
    return {
        scope: "line",
        file: relativePath(parent, "file", path),
        startLine,
        endLine,
        side: choice(parent, "side", path, ["new", "old"]),
    };
}

function fileLocation(parent: Json, path: string): Location {
    rejectUnknownKeys(parent, ["scope", "file"], path);
    return { scope: "file", file: relativePath(parent, "file", path) };
}

function changeLocation(parent: Json, path: string): Location {
    rejectUnknownKeys(parent, ["scope"], path);
    return { scope: "change" };
}

const LOCATION_READERS: Readonly<
    Record<(typeof SCOPES)[number], (p: Json, path: string) => Location>
> = { line: lineLocation, file: fileLocation, change: changeLocation };

function location(value: unknown, path: string): Location {
    const parent = object(value, path);
    return LOCATION_READERS[choice(parent, "scope", path, SCOPES)](parent, path);
}

function nativeSeverity(parent: Json, path: string, reviewer: ReviewerId): string {
    const value = nonEmpty(parent, "nativeSeverity", path);
    if (deriveSeverity(reviewer, value) === undefined) {
        throw new ParseError(
            `${path}.nativeSeverity ${JSON.stringify(value)} is not listed in the ${reviewer} severity table (${Object.keys(SEVERITY_TABLES[reviewer]).join(", ")})`,
        );
    }
    return value;
}

const FINDING_KEYS = [
    "kind",
    "title",
    "statement",
    "location",
    "evidence",
    "label",
    "nativeSeverity",
    "suggestedFix",
];
const DOUBT_KEYS = ["kind", "title", "statement", "location", "label", "evidence"];

function finding(
    parent: Json,
    path: string,
    reviewer: ReviewerId,
    extraKeys: readonly string[],
): RawFinding {
    rejectUnknownKeys(parent, [...FINDING_KEYS, ...extraKeys], path);
    return {
        kind: choice(parent, "kind", path, ["finding"]),
        title: oneLine(parent, "title", path),
        statement: nonEmpty(parent, "statement", path),
        location: location(parent.location, `${path}.location`),
        evidence: nonEmpty(parent, "evidence", path),
        label: choice(parent, "label", path, ["issue", "suggestion"]),
        nativeSeverity: nativeSeverity(parent, path, reviewer),
        ...withOptional("suggestedFix", optional(parent, "suggestedFix", path, nonEmpty)),
    };
}

// Spec "Doubts are reported apart": a doubt that names no label is read as a question.
function doubtLabel(parent: Json, path: string): "question" {
    return "label" in parent ? choice(parent, "label", path, ["question"]) : "question";
}

function doubt(parent: Json, path: string, extraKeys: readonly string[]): RawDoubt {
    rejectUnknownKeys(parent, [...DOUBT_KEYS, ...extraKeys], path);
    return {
        kind: choice(parent, "kind", path, ["doubt"]),
        title: oneLine(parent, "title", path),
        statement: nonEmpty(parent, "statement", path),
        location: location(parent.location, `${path}.location`),
        label: doubtLabel(parent, path),
        ...withOptional("evidence", optional(parent, "evidence", path, nonEmpty)),
    };
}

function reviewerId(parent: Json, key: string, path: string): ReviewerId {
    return choice(parent, key, path, REVIEWER_IDS);
}

function rawItem(reviewer: ReviewerId): Reader<RawItem> {
    return (value, path) => {
        const parent = object(value, path);
        return choice(parent, "kind", path, ["finding", "doubt"]) === "finding"
            ? finding(parent, path, reviewer, [])
            : doubt(parent, path, []);
    };
}

function droppedList(parent: Json, key: string, path: string): DroppedEntry[] {
    return list(parent, key, path, droppedEntry);
}

function droppedEntry(value: unknown, path: string): DroppedEntry {
    const parent = object(value, path);
    rejectUnknownKeys(parent, ["entry", "reason"], path);
    return { entry: nonEmpty(parent, "entry", path), reason: nonEmpty(parent, "reason", path) };
}

function reviewerFile(input: unknown): ReviewerFile {
    const parent = object(input, "$");
    const common = {
        schema: choice(parent, "schema", "$", [FINDING_SCHEMA]),
        reviewer: reviewerId(parent, "reviewer", "$"),
        ...withOptional("durationMs", optional(parent, "durationMs", "$", duration)),
    };
    if (choice(parent, "outcome", "$", ["reported", "skipped"]) === "skipped") {
        rejectUnknownKeys(parent, ["schema", "reviewer", "outcome", "durationMs", "reason"], "$");
        return { ...common, outcome: "skipped", reason: nonEmpty(parent, "reason", "$") };
    }
    rejectUnknownKeys(
        parent,
        ["schema", "reviewer", "outcome", "durationMs", "items", "dropped"],
        "$",
    );
    return {
        ...common,
        outcome: "reported",
        items: list(parent, "items", "$", rawItem(common.reviewer)),
        ...withOptional("dropped", optional(parent, "dropped", "$", droppedList)),
    };
}

function duration(parent: Json, key: string, path: string): number {
    const value = number(parent, key, path);
    if (value < 0) {
        throw new ParseError(`${path}.${key} must not be negative`);
    }
    return value;
}

// Strict: an unknown key, a missing field or a native severity the reviewer's
// table does not list is an error naming its path.
export function parseReviewerFile(input: unknown): Result<ReviewerFile> {
    return toResult(() => reviewerFile(input));
}

export function engine(value: unknown, path: string): Engine {
    const parent = object(value, path);
    rejectUnknownKeys(parent, ["tool", "version", "model", "effort", "level"], path);
    return {
        tool: nonEmpty(parent, "tool", path),
        version: nonEmpty(parent, "version", path),
        ...withOptional("model", optional(parent, "model", path, nonEmpty)),
        ...withOptional("effort", optional(parent, "effort", path, nonEmpty)),
        ...withOptional("level", optional(parent, "level", path, nonEmpty)),
    };
}

function reporter(value: unknown, path: string): Reporter {
    const parent = object(value, path);
    rejectUnknownKeys(parent, ["reviewer", "id"], path);
    return { reviewer: reviewerId(parent, "reviewer", path), id: nonEmpty(parent, "id", path) };
}

function ownReporterFirst(reporters: Reporter[], own: Reporter, path: string): void {
    const [first] = reporters;
    if (first?.reviewer !== own.reviewer || first.id !== own.id) {
        throw new ParseError(`${path}.reporters must list the finding itself first`);
    }
}

function reportedFinding(value: unknown, path: string): Finding {
    const parent = object(value, path);
    const reviewer = reviewerId(parent, "reviewer", path);
    const raw = finding(parent, path, reviewer, [
        "id",
        "reviewer",
        "engine",
        "severity",
        "reporters",
    ]);
    const severity = choice(parent, "severity", path, SEVERITIES);
    const expected = deriveSeverity(reviewer, raw.nativeSeverity);
    if (severity !== expected) {
        throw new ParseError(
            `${path}.severity must be ${expected} for ${reviewer} native severity ${JSON.stringify(raw.nativeSeverity)} (got ${severity})`,
        );
    }
    const id = nonEmpty(parent, "id", path);
    const reporters = list(parent, "reporters", path, reporter);
    ownReporterFirst(reporters, { reviewer, id }, path);
    return {
        ...raw,
        id,
        reviewer,
        engine: engine(parent.engine, `${path}.engine`),
        severity,
        reporters,
    };
}

function reportedDoubt(value: unknown, path: string): Doubt {
    const parent = object(value, path);
    return {
        ...doubt(parent, path, ["id", "reviewer", "engine"]),
        id: nonEmpty(parent, "id", path),
        reviewer: reviewerId(parent, "reviewer", path),
        engine: engine(parent.engine, `${path}.engine`),
    };
}

export function subject(value: unknown, path: string): Subject {
    const parent = object(value, path);
    rejectUnknownKeys(
        parent,
        ["repo", "branch", "base", "baseSource", "mergeBase", "head", "dirty"],
        path,
    );
    return {
        repo: nonEmpty(parent, "repo", path),
        branch: nonEmpty(parent, "branch", path),
        base: nonEmpty(parent, "base", path),
        baseSource: choice(parent, "baseSource", path, ["given", "pull-request", "default-branch"]),
        mergeBase: nonEmpty(parent, "mergeBase", path),
        head: nonEmpty(parent, "head", path),
        dirty: boolean(parent, "dirty", path),
    };
}

export function measure(value: unknown, path: string): Measure {
    const parent = object(value, path);
    rejectUnknownKeys(parent, ["lines", "files"], path);
    return {
        lines: integerAtLeast(parent, "lines", path, 0),
        files: integerAtLeast(parent, "files", path, 0),
    };
}

export function tierChoice(value: unknown, path: string): TierChoice {
    const parent = object(value, path);
    rejectUnknownKeys(parent, ["measured", "used", "reason"], path);
    return {
        measured: choice<Tier>(parent, "measured", path, TIERS),
        used: choice<Tier>(parent, "used", path, TIERS),
        ...withOptional("reason", optional(parent, "reason", path, nonEmpty)),
    };
}

function securityMatch(value: unknown, path: string): SecurityMatch {
    const parent = object(value, path);
    rejectUnknownKeys(parent, ["kind", "pattern", "file", "line"], path);
    return {
        kind: choice(parent, "kind", path, ["path", "line"]),
        pattern: nonEmpty(parent, "pattern", path),
        file: relativePath(parent, "file", path),
        ...withOptional("line", optional(parent, "line", path, positive)),
    };
}

function positive(parent: Json, key: string, path: string): number {
    return integerAtLeast(parent, key, path, 1);
}

export function security(value: unknown, path: string): Report["security"] {
    const parent = object(value, path);
    rejectUnknownKeys(parent, ["triggered", "matches"], path);
    return {
        triggered: boolean(parent, "triggered", path),
        matches: list(parent, "matches", path, securityMatch),
    };
}

function reviewerOutcome(value: unknown, path: string): ReviewerOutcome {
    const parent = object(value, path);
    rejectUnknownKeys(
        parent,
        ["reviewer", "outcome", "reason", "required", "engine", "durationMs", "dropped"],
        path,
    );
    return {
        reviewer: reviewerId(parent, "reviewer", path),
        outcome: choice(parent, "outcome", path, ["reported", "skipped", "failed"]),
        required: boolean(parent, "required", path),
        ...withOptional("reason", optional(parent, "reason", path, nonEmpty)),
        ...withOptional("engine", optional(parent, "engine", path, field(engine))),
        ...withOptional("durationMs", optional(parent, "durationMs", path, duration)),
        ...withOptional("dropped", optional(parent, "dropped", path, droppedList)),
    };
}

function guideFile(parent: Json, key: string, path: string): string {
    return relativePath(parent, key, path);
}

function walkthrough(value: unknown, path: string): WalkthroughGuide {
    const parent = object(value, path);
    rejectUnknownKeys(parent, ["guide", "patch", "html", "reason"], path);
    return {
        guide: parent.guide === null ? null : guideFile(parent, "guide", path),
        ...withOptional("patch", optional(parent, "patch", path, guideFile)),
        ...withOptional("html", optional(parent, "html", path, guideFile)),
        ...withOptional("reason", optional(parent, "reason", path, nonEmpty)),
    };
}

function assertUniqueIds(findings: Finding[], doubts: Doubt[]): void {
    const seen = new Set<string>();
    for (const { id } of [...findings, ...doubts]) {
        if (seen.has(id)) {
            throw new ParseError(`$ holds the id ${JSON.stringify(id)} more than once`);
        }
        seen.add(id);
    }
}

function report(input: unknown): Report {
    const parent = object(input, "$");
    rejectUnknownKeys(
        parent,
        [
            "schema",
            "subject",
            "measure",
            "tier",
            "security",
            "reviewers",
            "findings",
            "doubts",
            "walkthrough",
            "errors",
        ],
        "$",
    );
    const value: Report = {
        schema: choice(parent, "schema", "$", [REPORT_SCHEMA]),
        subject: subject(parent.subject, "$.subject"),
        measure: measure(parent.measure, "$.measure"),
        tier: tierChoice(parent.tier, "$.tier"),
        security: security(parent.security, "$.security"),
        reviewers: list(parent, "reviewers", "$", reviewerOutcome),
        findings: list(parent, "findings", "$", reportedFinding),
        doubts: list(parent, "doubts", "$", reportedDoubt),
        walkthrough: walkthrough(parent.walkthrough, "$.walkthrough"),
        errors: stringArray(parent, "errors", "$"),
    };
    assertUniqueIds(value.findings, value.doubts);
    return value;
}

// Validates `autonomous.review-report.v1`, for tests and for anything that
// reads a report back. The severity of each finding must be the one its
// reviewer's table gives.
export function parseReport(input: unknown): Result<Report> {
    return toResult(() => report(input));
}
