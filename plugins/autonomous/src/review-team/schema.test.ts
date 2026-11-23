import { describe, expect, it } from "vitest";

import { parseReport, parseReviewerFile } from "./schema.ts";

type Obj = Record<string, unknown>;

const line = (extra: Obj = {}): Obj => ({
    scope: "line",
    file: "src/a.ts",
    startLine: 10,
    endLine: 12,
    side: "new",
    ...extra,
});

const finding = (extra: Obj = {}): Obj => ({
    kind: "finding",
    title: "Missing await on save",
    statement: "The save is not awaited, so the caller continues before it ends.",
    location: line(),
    evidence: "await is absent on line 10",
    label: "issue",
    nativeSeverity: "important",
    ...extra,
});

const doubt = (extra: Obj = {}): Obj => ({
    kind: "doubt",
    title: "Was removing the flag intended?",
    statement: "The flag is deleted with no replacement and no mention of it.",
    location: line({ startLine: 7, endLine: 7 }),
    label: "question",
    ...extra,
});

const file = (items: unknown[], extra: Obj = {}): Obj => ({
    schema: "autonomous.finding.v1",
    reviewer: "code-review",
    outcome: "reported",
    items,
    ...extra,
});

const error = (result: { ok: boolean; error?: string }): string => {
    expect(result.ok).toBe(false);
    return result.error ?? "";
};

describe("parseReviewerFile, a reported file", () => {
    it("accepts a finding with a line location", () => {
        const result = parseReviewerFile(file([finding({ suggestedFix: "Add await." })]));
        expect(result).toMatchObject({ ok: true });
        expect(result.ok && result.value).toMatchObject({
            outcome: "reported",
            items: [
                {
                    kind: "finding",
                    label: "issue",
                    nativeSeverity: "important",
                    suggestedFix: "Add await.",
                    location: { scope: "line", startLine: 10, endLine: 12, side: "new" },
                },
            ],
        });
    });

    it.each([
        ["a file", { scope: "file", file: "src/a.ts" }],
        ["the whole change", { scope: "change" }],
        ["an old-side line", line({ side: "old" })],
        ["a single line", line({ startLine: 5, endLine: 5 })],
    ])("accepts a finding located at %s", (_name, location) => {
        expect(parseReviewerFile(file([finding({ location })])).ok).toBe(true);
    });

    it("accepts an empty list of items and a duration", () => {
        expect(parseReviewerFile(file([], { durationMs: 1200 })).ok).toBe(true);
    });

    it("accepts a skipped file with its reason", () => {
        const result = parseReviewerFile({
            schema: "autonomous.finding.v1",
            reviewer: "codex",
            outcome: "skipped",
            reason: "timed out",
        });
        expect(result).toEqual({
            ok: true,
            value: {
                schema: "autonomous.finding.v1",
                reviewer: "codex",
                outcome: "skipped",
                reason: "timed out",
            },
        });
    });
});

describe("parseReviewerFile, doubts", () => {
    it("accepts a doubt with a question label and no severity", () => {
        const result = parseReviewerFile(file([doubt()]));
        expect(result.ok && result.value).toMatchObject({
            items: [{ kind: "doubt", label: "question", location: { startLine: 7 } }],
        });
        expect(result.ok && JSON.stringify(result.value)).not.toContain("nativeSeverity");
    });

    it("accepts a doubt with evidence", () => {
        expect(parseReviewerFile(file([doubt({ evidence: "removed in the first hunk" })])).ok).toBe(
            true,
        );
    });

    it.each([
        ["a native severity", { nativeSeverity: "nit" }],
        ["a severity", { severity: "WARNING" }],
        ["a suggested fix", { suggestedFix: "Restore the flag." }],
    ])("rejects a doubt carrying %s", (_name, extra) => {
        const [key] = Object.keys(extra);
        expect(error(parseReviewerFile(file([doubt(extra)])))).toBe(
            `$.items[0].${key} is not a recognised field`,
        );
    });

    it("Doubt without a label: passes validation and is read as a question", () => {
        const { label: _label, ...unlabelled } = doubt();

        const result = parseReviewerFile(file([unlabelled]));

        expect(result.ok && result.value).toMatchObject({
            items: [{ kind: "doubt", label: "question" }],
        });
    });

    it("does not read a missing label of a finding as anything", () => {
        const { label: _label, ...unlabelled } = finding();

        expect(error(parseReviewerFile(file([unlabelled])))).toBe(
            "$.items[0].label must be a string",
        );
    });

    it.each(["issue", "suggestion"])("rejects a doubt labelled %s", (label) => {
        expect(error(parseReviewerFile(file([doubt({ label })])))).toContain(
            "$.items[0].label must be one of question",
        );
    });

    it("rejects a finding labelled question", () => {
        expect(error(parseReviewerFile(file([finding({ label: "question" })])))).toContain(
            "$.items[0].label must be one of issue, suggestion",
        );
    });
});

describe("parseReviewerFile, dropped entries", () => {
    const dropped = {
        entry: "- [P1] T — /elsewhere/a.ts:1-1",
        reason: "/elsewhere/a.ts is not inside the repository",
    };

    it("accepts a dropped list of entries with a reason", () => {
        const result = parseReviewerFile(file([], { dropped: [dropped] }));

        expect(result.ok && result.value).toMatchObject({ dropped: [dropped] });
    });

    it.each([
        ["not an array", { dropped: "x" }, "$.dropped must be an array"],
        ["an entry that is not an object", { dropped: ["x"] }, "$.dropped[0] must be an object"],
        [
            "an entry with no reason",
            { dropped: [{ entry: "x" }] },
            "$.dropped[0].reason must be a string",
        ],
        [
            "an entry with an empty reason",
            { dropped: [{ entry: "x", reason: " " }] },
            "$.dropped[0].reason must not be empty",
        ],
        [
            "an empty entry",
            { dropped: [{ entry: "", reason: "r" }] },
            "$.dropped[0].entry must not be empty",
        ],
        [
            "an unknown key",
            { dropped: [{ entry: "x", reason: "r", path: "p" }] },
            "$.dropped[0].path is not a recognised field",
        ],
    ])("rejects a dropped list with %s, naming its path", (_name, extra, message) => {
        expect(error(parseReviewerFile(file([], extra)))).toBe(message);
    });

    it("rejects a dropped list in a skipped file", () => {
        const skipped = {
            schema: "autonomous.finding.v1",
            reviewer: "codex",
            outcome: "skipped",
            reason: "r",
            dropped: [dropped],
        };

        expect(error(parseReviewerFile(skipped))).toBe("$.dropped is not a recognised field");
    });
});

describe("parseReviewerFile, errors name their path", () => {
    it("rejects a finding missing its location", () => {
        const { location: _location, ...withoutLocation } = finding();
        expect(error(parseReviewerFile(file([finding(), finding(), withoutLocation])))).toBe(
            "$.items[2].location must be an object",
        );
    });

    it("rejects a native severity its reviewer's table does not list, naming the value", () => {
        const message = error(parseReviewerFile(file([finding({ nativeSeverity: "P1" })])));
        expect(message).toContain("$.items[0].nativeSeverity");
        expect(message).toContain('"P1"');
        expect(message).toContain("code-review severity table");
    });

    it("accepts the same word where the reviewer's own table lists it", () => {
        const input = file([finding({ nativeSeverity: "P1" })], { reviewer: "codex" });
        expect(parseReviewerFile(input).ok).toBe(true);
    });

    it("rejects a finding with no native severity", () => {
        const { nativeSeverity: _native, ...without } = finding();
        expect(error(parseReviewerFile(file([without])))).toBe(
            "$.items[0].nativeSeverity must be a string",
        );
    });

    it.each([
        ["an empty title", { title: "  " }, "$.items[0].title must not be empty"],
        ["a two-line title", { title: "a\nb" }, "$.items[0].title must be a single line"],
        ["an empty statement", { statement: "" }, "$.items[0].statement must not be empty"],
        ["an empty evidence", { evidence: "" }, "$.items[0].evidence must not be empty"],
        [
            "an empty suggested fix",
            { suggestedFix: "" },
            "$.items[0].suggestedFix must not be empty",
        ],
        ["an unknown key", { confidence: 0.9 }, "$.items[0].confidence is not a recognised field"],
        ["an unknown kind", { kind: "note" }, "$.items[0].kind must be one of finding, doubt"],
    ])("rejects %s", (_name, extra, message) => {
        expect(error(parseReviewerFile(file([finding(extra)])))).toContain(message);
    });

    it.each([
        [
            "a start line of 0",
            line({ startLine: 0 }),
            "$.items[0].location.startLine must be an integer >= 1",
        ],
        [
            "a fractional line",
            line({ endLine: 12.5 }),
            "$.items[0].location.endLine must be an integer >= 1",
        ],
        [
            "an end before the start",
            line({ endLine: 9 }),
            "$.items[0].location.endLine must be >= startLine",
        ],
        ["a missing side", line({ side: undefined }), "$.items[0].location.side must be a string"],
        [
            "an unknown side",
            line({ side: "both" }),
            "$.items[0].location.side must be one of new, old",
        ],
        [
            "an unknown scope",
            { scope: "hunk" },
            "$.items[0].location.scope must be one of line, file, change",
        ],
        [
            "lines on a file scope",
            { scope: "file", file: "a.ts", startLine: 1 },
            "$.items[0].location.startLine is not a recognised field",
        ],
        [
            "a file on a change scope",
            { scope: "change", file: "a.ts" },
            "$.items[0].location.file is not a recognised field",
        ],
    ])("rejects a location with %s", (_name, location, message) => {
        expect(error(parseReviewerFile(file([finding({ location })])))).toContain(message);
    });

    it.each(["/etc/passwd", "../outside.ts", "src/../../x.ts", "src\\a.ts", "C:/repo/a.ts", ""])(
        "rejects the file %j",
        (path) => {
            const location = line({ file: path });
            expect(error(parseReviewerFile(file([finding({ location })])))).toMatch(
                /^\$\.items\[0\]\.location\.file must (be relative|not be empty)/,
            );
        },
    );

    it.each([
        ["not an object", "text", "$ must be an object"],
        [
            "an unknown schema",
            file([], { schema: "autonomous.finding.v2" }),
            "$.schema must be one of autonomous.finding.v1",
        ],
        ["an unknown reviewer", file([], { reviewer: "gemini" }), "$.reviewer must be one of"],
        [
            "an unknown outcome",
            file([], { outcome: "failed" }),
            "$.outcome must be one of reported, skipped",
        ],
        ["an unknown key", file([], { extra: 1 }), "$.extra is not a recognised field"],
        [
            "items on a skipped file",
            file([], { outcome: "skipped", reason: "x" }),
            "$.items is not a recognised field",
        ],
        [
            "a skipped file without a reason",
            { schema: "autonomous.finding.v1", reviewer: "codex", outcome: "skipped" },
            "$.reason must be a string",
        ],
        [
            "a reported file without items",
            { schema: "autonomous.finding.v1", reviewer: "codex", outcome: "reported" },
            "$.items must be an array",
        ],
        ["a negative duration", file([], { durationMs: -1 }), "$.durationMs must not be negative"],
    ])("rejects %s", (_name, input, message) => {
        expect(error(parseReviewerFile(input))).toContain(message);
    });
});

const engine = { tool: "codex", version: "0.99.0", model: "gpt-5.5", effort: "high" };

const reportedFinding = (extra: Obj = {}): Obj => ({
    ...finding({ nativeSeverity: "P1" }),
    id: "codex-1",
    reviewer: "codex",
    engine,
    severity: "CRITICAL",
    reporters: [{ reviewer: "codex", id: "codex-1" }],
    location: line({ startLine: 10, endLine: 12 }),
    ...extra,
});

const reportedDoubt = (extra: Obj = {}): Obj => ({
    ...doubt(),
    id: "walkthrough-1",
    reviewer: "walkthrough",
    engine: { tool: "claude-code", version: "2.1.0", model: "opus" },
    ...extra,
});

const report = (extra: Obj = {}): Obj => ({
    schema: "autonomous.review-report.v1",
    subject: {
        repo: "demo",
        branch: "feature/x",
        base: "main",
        baseSource: "given",
        mergeBase: "abc123",
        head: "def456",
        dirty: false,
    },
    measure: { lines: 40, files: 2 },
    tier: { measured: "S", used: "M", reason: "touches the loop" },
    security: {
        triggered: true,
        matches: [
            { kind: "line", pattern: "exec", file: "src/a.ts", line: 3 },
            { kind: "path", pattern: "auth", file: "src/auth.ts" },
        ],
    },
    reviewers: [
        { reviewer: "codex", outcome: "reported", required: false, engine, durationMs: 900 },
        { reviewer: "coderabbit", outcome: "skipped", required: false, reason: "not installed" },
    ],
    findings: [reportedFinding()],
    doubts: [reportedDoubt()],
    walkthrough: {
        guide: "walkthrough.json",
        patch: "walkthrough.patch",
        html: "walkthrough.html",
    },
    errors: [],
    ...extra,
});

describe("parseReport, dropped entries", () => {
    it("accepts a reviewer outcome with its dropped entries", () => {
        const dropped = [{ entry: "- [P1] T — /elsewhere/a.ts:1-1", reason: "r" }];
        const input = report({
            reviewers: [{ reviewer: "codex", outcome: "reported", required: false, dropped }],
        });

        const result = parseReport(input);

        expect(result.ok && result.value.reviewers[0]).toMatchObject({ dropped });
    });
});

describe("parseReport", () => {
    it("accepts a line finding from Codex with its derived severity and engine", () => {
        const result = parseReport(report());
        expect(result.ok && result.value.findings[0]).toMatchObject({
            kind: "finding",
            label: "issue",
            nativeSeverity: "P1",
            severity: "CRITICAL",
            location: { scope: "line", file: "src/a.ts", startLine: 10, endLine: 12, side: "new" },
            engine: { tool: "codex", version: "0.99.0" },
        });
    });

    it("lists a doubt apart from the findings, with no severity", () => {
        const result = parseReport(report());
        expect(result.ok && result.value.doubts).toHaveLength(1);
        expect(result.ok && result.value.doubts[0]).toMatchObject({
            kind: "doubt",
            label: "question",
        });
        expect(result.ok && result.value.doubts[0]).not.toHaveProperty("severity");
    });

    it("accepts a report with no guide and a reason", () => {
        const walkthrough = { guide: null, reason: "plannotator missing" };
        expect(parseReport(report({ walkthrough })).ok).toBe(true);
    });

    it("accepts an empty review with errors", () => {
        const input = report({ findings: [], doubts: [], errors: ["walkthrough wrote nothing"] });
        expect(parseReport(input).ok).toBe(true);
    });

    it.each([
        [
            "a finding without an id",
            { findings: [reportedFinding({ id: undefined })] },
            "$.findings[0].id must be a string",
        ],
        [
            "a finding without an engine",
            { findings: [reportedFinding({ engine: undefined })] },
            "$.findings[0].engine must be an object",
        ],
        [
            "an engine without a version",
            { findings: [reportedFinding({ engine: { tool: "codex" } })] },
            "$.findings[0].engine.version must be a string",
        ],
        [
            "a finding without a location",
            { findings: [reportedFinding({ location: undefined })] },
            "$.findings[0].location must be an object",
        ],
        [
            "a severity that differs from the table",
            { findings: [reportedFinding({ severity: "WARNING" })] },
            '$.findings[0].severity must be CRITICAL for codex native severity "P1"',
        ],
        [
            "an unknown native severity",
            { findings: [reportedFinding({ nativeSeverity: "P9" })] },
            '$.findings[0].nativeSeverity "P9" is not listed in the codex severity table',
        ],
        [
            "reporters that do not list the finding first",
            {
                findings: [
                    reportedFinding({
                        reporters: [{ reviewer: "code-review", id: "code-review-1" }],
                    }),
                ],
            },
            "$.findings[0].reporters must list the finding itself first",
        ],
        [
            "no reporters",
            { findings: [reportedFinding({ reporters: [] })] },
            "$.findings[0].reporters must list the finding itself first",
        ],
        [
            "a doubt with a severity",
            { doubts: [reportedDoubt({ severity: "WARNING" })] },
            "$.doubts[0].severity is not a recognised field",
        ],
        [
            "a doubt with a native severity",
            { doubts: [reportedDoubt({ nativeSeverity: "nit" })] },
            "$.doubts[0].nativeSeverity is not a recognised field",
        ],
        [
            "a doubt in the findings",
            { findings: [reportedDoubt()] },
            "$.findings[0].kind must be one of finding",
        ],
        [
            "a finding in the doubts",
            { doubts: [reportedFinding()] },
            "$.doubts[0].nativeSeverity is not a recognised field",
        ],
        ["a repeated id", { doubts: [reportedDoubt({ id: "codex-1" })] }, "more than once"],
        [
            "an unknown schema",
            { schema: "autonomous.review-report.v2" },
            "$.schema must be one of autonomous.review-report.v1",
        ],
        ["an unknown key", { summary: "x" }, "$.summary is not a recognised field"],
        ["a missing subject", { subject: undefined }, "$.subject must be an object"],
        [
            "an unknown tier",
            { tier: { measured: "XL", used: "L" } },
            "$.tier.measured must be one of S, M, L",
        ],
        [
            "a non-boolean dirty",
            { subject: { ...(report().subject as Obj), dirty: "no" } },
            "$.subject.dirty must be a boolean",
        ],
        [
            "a negative measure",
            { measure: { lines: -1, files: 2 } },
            "$.measure.lines must be an integer >= 0",
        ],
        [
            "a security match on line 0",
            {
                security: {
                    triggered: true,
                    matches: [{ kind: "line", pattern: "x", file: "a.ts", line: 0 }],
                },
            },
            "$.security.matches[0].line must be an integer >= 1",
        ],
        [
            "an unknown reviewer outcome",
            { reviewers: [{ reviewer: "codex", outcome: "crashed", required: false }] },
            "$.reviewers[0].outcome must be one of reported, skipped, failed",
        ],
        [
            "a reviewer outcome whose dropped entry has no reason",
            {
                reviewers: [
                    {
                        reviewer: "codex",
                        outcome: "reported",
                        required: false,
                        dropped: [{ entry: "x" }],
                    },
                ],
            },
            "$.reviewers[0].dropped[0].reason must be a string",
        ],
        [
            "an absolute guide path",
            { walkthrough: { guide: "/tmp/walkthrough.json" } },
            "$.walkthrough.guide must be relative",
        ],
        ["a missing guide key", { walkthrough: {} }, "$.walkthrough.guide must be a string"],
        ["errors that are not strings", { errors: [1] }, "$.errors[0] must be a string"],
    ])("rejects %s", (_name, extra, message) => {
        expect(error(parseReport(report(extra)))).toContain(message);
    });
});
