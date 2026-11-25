import { readFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { temporaryDirectories } from "../stages/test-fixtures.ts";
import { renderReport, writeReport } from "./report.ts";
import { parseReport } from "./schema.ts";
import type { Doubt, Finding, Location, Report, ReviewerId, Severity } from "./types.ts";

const directories = temporaryDirectories("review-report");

afterEach(async () => {
    await directories.removeAll();
});

const NATIVE: Readonly<Record<Severity, string>> = {
    CRITICAL: "P1",
    WARNING: "P2",
    SUGGESTION: "P3",
};

function finding(n: number, severity: Severity, title: string, location: Location): Finding {
    const id = `codex-${n}`;
    return {
        kind: "finding",
        title,
        statement: "What is wrong.",
        location,
        evidence: "What shows it.",
        label: "issue",
        nativeSeverity: NATIVE[severity],
        id,
        reviewer: "codex",
        engine: { tool: "codex", version: "0.169.0", effort: "medium" },
        severity,
        reporters: [{ reviewer: "codex", id }],
    };
}

function doubt(id: string, reviewer: ReviewerId): Doubt {
    return {
        kind: "doubt",
        title: "Was the offline check removed on purpose?",
        statement: "Nothing says whether retries replace it.",
        location: { scope: "file", file: "src/upload/queue.ts" },
        label: "question",
        id,
        reviewer,
        engine: { tool: "claude-code", version: "2.1.0", model: "opus" },
    };
}

const line = (
    file: string,
    startLine: number,
    endLine = startLine,
    side: "new" | "old" = "new",
): Location => ({
    scope: "line",
    file,
    startLine,
    endLine,
    side,
});

function report(extra: Partial<Report> = {}): Report {
    const grouped = finding(3, "CRITICAL", "Missing await on save", line("src/a.ts", 40));
    grouped.reporters.push({ reviewer: "code-review", id: "code-review-1" });
    return {
        schema: "autonomous.review-report.v1",
        subject: {
            repo: "my-repo",
            branch: "feature/retries",
            base: "main",
            baseSource: "pull-request",
            mergeBase: "1111111111111111111111111111111111111111",
            head: "2222222222222222222222222222222222222222",
            dirty: true,
        },
        measure: { lines: 90, files: 3 },
        tier: { measured: "S", used: "L", reason: "it touches the label contract" },
        security: {
            triggered: true,
            matches: [{ kind: "line", pattern: "execFile", file: "src/run.ts", line: 12 }],
        },
        reviewers: [
            {
                reviewer: "codex",
                outcome: "reported",
                required: false,
                engine: { tool: "codex", version: "0.169.0", effort: "medium" },
                durationMs: 61_500,
            },
            {
                reviewer: "coderabbit",
                outcome: "skipped",
                reason: "rate limited",
                required: false,
                engine: { tool: "coderabbit", version: "0.9.5" },
            },
            {
                reviewer: "walkthrough",
                outcome: "failed",
                reason: "ended without writing its output (reviewers/walkthrough.json)",
                required: true,
                engine: { tool: "claude-code", version: "2.1.0" },
            },
            {
                reviewer: "fallow-review",
                outcome: "skipped",
                reason: "not applicable: no package.json",
                required: false,
            },
        ],
        findings: [
            finding(1, "SUGGESTION", "Name the constant", { scope: "change" }),
            finding(2, "WARNING", "Retry count is hard-coded", { scope: "file", file: "src/b.ts" }),
            grouped,
            finding(4, "CRITICAL", "Old branch still reachable", line("src/c.ts", 7, 9, "old")),
        ],
        doubts: [doubt("tests-lens-1", "tests-lens")],
        walkthrough: {
            guide: null,
            reason: "Plannotator is not available (plannotator CLI not found on PATH)",
        },
        errors: [
            "the required reviewer walkthrough failed: ended without writing its output (reviewers/walkthrough.json)",
        ],
        ...extra,
    };
}

function sectionOf(markdown: string, heading: string): string {
    const start = markdown.indexOf(`## ${heading}\n`);
    expect(start, heading).toBeGreaterThanOrEqual(0);
    const rest = markdown.slice(start + `## ${heading}\n\n`.length);
    const end = rest.search(/^## /m);
    return end < 0 ? rest : rest.slice(0, end);
}

describe("renderReport (design D11)", () => {
    const markdown = renderReport(report());

    it("states the subject, the tier and why, and the security trigger", () => {
        expect(markdown).toMatch(/^# Review of my-repo, `feature\/retries`\n/);
        expect(markdown).toContain(
            "Against `main` (pull-request), from `111111111111` to `222222222222`: 90 lines in 3 files. Uncommitted changes were left out of the review.",
        );
        expect(markdown).toContain(
            "Tier L, raised from the measured S: it touches the label contract",
        );
        expect(markdown).toContain("The security reviewer joined: `execFile` at `src/run.ts:12`.");
    });

    it("says a tier that was not raised is the measured one, and an untriggered security check", () => {
        const plain = renderReport(
            report({
                tier: { measured: "M", used: "M" },
                security: { triggered: false, matches: [] },
            }),
        );

        expect(plain).toContain("Tier M, as measured.");
        expect(plain).toContain("No security pattern matched.");
    });

    it("names who ran, who was skipped and who failed, with engines, durations and reasons", () => {
        expect(sectionOf(markdown, "Reviewers")).toBe(
            [
                "Ran:",
                "",
                "- `codex` (codex 0.169.0, effort medium, 61.5 s)",
                "",
                "Skipped:",
                "",
                "- `coderabbit` (coderabbit 0.9.5): rate limited",
                "- `fallow-review`: not applicable: no package.json",
                "",
                "Failed:",
                "",
                "- `walkthrough` (claude-code 2.1.0): ended without writing its output (reviewers/walkthrough.json)",
                "",
                "",
            ].join("\n"),
        );
    });

    it("names each dropped entry under its reviewer, with the reason", () => {
        const dropped = {
            entry: "- [P1] Await the write — /elsewhere/src/a.ts:13-13",
            reason: "/elsewhere/src/a.ts is not inside the repository",
        };
        const base = report();
        const withDropped = renderReport({
            ...base,
            reviewers: base.reviewers.map((outcome) =>
                outcome.reviewer === "codex" ? { ...outcome, dropped: [dropped] } : outcome,
            ),
        });

        expect(sectionOf(withDropped, "Reviewers")).toContain(
            [
                "- `codex` (codex 0.169.0, effort medium, 61.5 s)",
                `  - dropped "${dropped.entry}": ${dropped.reason}`,
                "",
                "Skipped:",
            ].join("\n"),
        );
        expect(sectionOf(markdown, "Reviewers")).not.toContain("dropped");
    });

    it("lists the findings by severity, CRITICAL first, each with its location and reporters", () => {
        expect(sectionOf(markdown, "Findings")).toBe(
            [
                "### CRITICAL",
                "",
                "- Missing await on save, at `src/a.ts:40` (`codex-3`, `code-review-1`)",
                "- Old branch still reachable, at `src/c.ts:7-9` (old side) (`codex-4`)",
                "",
                "### WARNING",
                "",
                "- Retry count is hard-coded, at `src/b.ts` (`codex-2`)",
                "",
                "### SUGGESTION",
                "",
                "- Name the constant, at the whole change (`codex-1`)",
                "",
                "",
            ].join("\n"),
        );
    });

    it("lists the doubts apart from the findings", () => {
        expect(sectionOf(markdown, "Doubts")).toBe(
            "- Was the offline check removed on purpose?, at `src/upload/queue.ts` (`tests-lens-1`)\n\n",
        );
        expect(sectionOf(markdown, "Findings")).not.toContain("offline check");
    });

    it("says why there is no guide, and lists the errors", () => {
        expect(sectionOf(markdown, "Walkthrough guide")).toBe(
            "No guide: Plannotator is not available (plannotator CLI not found on PATH).\n\n",
        );
        expect(sectionOf(markdown, "Errors")).toBe(
            "- the required reviewer walkthrough failed: ended without writing its output (reviewers/walkthrough.json)\n",
        );
    });

    it("names the guide, and says when there are no findings, doubts or errors", () => {
        const empty = renderReport(
            report({
                findings: [],
                doubts: [],
                errors: [],
                walkthrough: {
                    guide: "walkthrough.json",
                    patch: "walkthrough.patch",
                    html: "walkthrough.html",
                },
            }),
        );

        expect(sectionOf(empty, "Walkthrough guide")).toBe(
            "`walkthrough.json`, checked against `walkthrough.patch`; its page is `walkthrough.html`.\n\n",
        );
        for (const heading of ["Findings", "Doubts", "Errors"]) {
            expect(sectionOf(empty, heading).trim(), heading).toBe("None.");
        }
    });
});

describe("writeReport", () => {
    it("writes report.json, which parses as a review report, and report.md", () => {
        const dir = directories.make("dir");

        const written = writeReport(dir, report());

        expect(written).toEqual({ ok: true, value: report() });
        const json: unknown = JSON.parse(readFileSync(join(dir, "report.json"), "utf8"));
        expect(parseReport(json)).toEqual({ ok: true, value: report() });
        expect(readFileSync(join(dir, "report.md"), "utf8")).toBe(renderReport(report()));
    });

    it("names no absolute path and not the home directory in either file", () => {
        const dir = directories.make("dir");
        const quoted = report({
            reviewers: [
                {
                    reviewer: "codex",
                    outcome: "skipped",
                    reason: `codex failed: see ${join(dir, "raw", "codex.stderr.txt")}`,
                    required: false,
                },
            ],
            walkthrough: {
                guide: null,
                reason: `plannotator guide export: cannot read ${join(dir, "walkthrough.patch")}`,
            },
            errors: [`could not check HEAD: ${join(homedir(), "repo")} is not a git repository`],
        });

        const written = writeReport(dir, quoted);

        expect(written.ok && written.value.reviewers[0]?.reason).toBe(
            "codex failed: see raw/codex.stderr.txt",
        );
        expect(written.ok && written.value.walkthrough.reason).toBe(
            "plannotator guide export: cannot read walkthrough.patch",
        );
        expect(written.ok && written.value.errors).toEqual([
            "could not check HEAD: ~/repo is not a git repository",
        ]);
        for (const name of ["report.json", "report.md"]) {
            const text = readFileSync(join(dir, name), "utf8");
            expect(text, name).not.toContain(dir);
            expect(text, name).not.toContain(homedir());
        }
    });

    it("names the home directory and the report directory of a dropped entry as ~ and .", () => {
        const dir = directories.make("dir");
        const base = report();
        const quoted = report({
            reviewers: base.reviewers.map((outcome) =>
                outcome.reviewer === "codex"
                    ? {
                          ...outcome,
                          dropped: [
                              {
                                  entry: `- [P1] T — ${join(homedir(), "x", "a.ts")}:1-1`,
                                  reason: `${join(dir, "a.ts")} is not inside the repository`,
                              },
                          ],
                      }
                    : outcome,
            ),
        });

        const written = writeReport(dir, quoted);

        expect(written.ok && written.value.reviewers[0]?.dropped).toEqual([
            { entry: "- [P1] T — ~/x/a.ts:1-1", reason: "a.ts is not inside the repository" },
        ]);
        for (const name of ["report.json", "report.md"]) {
            const text = readFileSync(join(dir, name), "utf8");
            expect(text, name).not.toContain(dir);
            expect(text, name).not.toContain(homedir());
        }
    });

    it("names the temp directory of a dropped entry as $TMPDIR, in both files", () => {
        const dir = directories.make("dir");
        const base = report();
        const quoted = report({
            reviewers: base.reviewers.map((outcome) =>
                outcome.reviewer === "codex"
                    ? {
                          ...outcome,
                          dropped: [
                              {
                                  entry: `- [P1] T — ${join(tmpdir(), "wt", "pr-94", "a.ts")}:1-1`,
                                  reason: "/private/tmp/claude-501/-Users-someone/wt/a.ts is not inside the repository",
                              },
                          ],
                      }
                    : outcome,
            ),
        });

        const written = writeReport(dir, quoted);

        expect(written.ok && written.value.reviewers[0]?.dropped).toEqual([
            {
                entry: "- [P1] T — $TMPDIR/wt/pr-94/a.ts:1-1",
                reason: "$TMPDIR/claude-501/-Users-someone/wt/a.ts is not inside the repository",
            },
        ]);
        for (const name of ["report.json", "report.md"]) {
            const text = readFileSync(join(dir, name), "utf8");
            expect(text, name).toContain("$TMPDIR/wt/pr-94/a.ts");
            expect(text, name).not.toContain(tmpdir());
            expect(text, name).not.toContain("/private/tmp");
        }
    });

    it("names the home directory in a finding's and a doubt's text as ~, and keeps ids and places", () => {
        const dir = directories.make("dir");
        const home = join(homedir(), "work", "a.ts");
        const base = report();
        const first = base.findings[0];
        const quotedFinding = {
            ...finding(9, "WARNING", `Check ${home}`, line("src/a.ts", 5)),
            statement: `${home} drops the value.`,
            evidence: `see ${home}:5`,
            suggestedFix: `edit ${home}`,
        };
        const quotedDoubt = { ...doubt("tests-lens-2", "tests-lens"), title: `Is ${home} used?` };
        const quoted = report({
            findings: [quotedFinding, ...(first === undefined ? [] : [first])],
            doubts: [quotedDoubt],
        });

        const written = writeReport(dir, quoted);

        expect(written.ok && written.value.findings[0]).toEqual({
            ...quotedFinding,
            title: "Check ~/work/a.ts",
            statement: "~/work/a.ts drops the value.",
            evidence: "see ~/work/a.ts:5",
            suggestedFix: "edit ~/work/a.ts",
        });
        expect(written.ok && written.value.doubts[0]).toEqual({
            ...quotedDoubt,
            title: "Is ~/work/a.ts used?",
        });
        for (const name of ["report.json", "report.md"]) {
            const text = readFileSync(join(dir, name), "utf8");
            expect(text, name).not.toContain(homedir());
            expect(text, name).toContain("~/work/a.ts");
        }
    });

    it("returns an error when the directory cannot take the files", () => {
        const dir = join(directories.make("dir"), "missing");

        const written = writeReport(dir, report());

        expect(written.ok ? "" : written.error).toMatch(/^writing the report: /);
    });
});
