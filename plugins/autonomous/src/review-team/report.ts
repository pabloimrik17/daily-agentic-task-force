// The report a review writes (spec review-team, "The report"; design D11):
// `report.json`, which follows `autonomous.review-report.v1`, and a short
// `report.md` for a person. Neither names an absolute path or the home
// directory: reasons that quote a tool's message are made relative first.

import { realpathSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";

import type { Result } from "../result.ts";
import {
    type Doubt,
    type Engine,
    type Finding,
    type Location,
    type Report,
    type ReviewerOutcome,
    SEVERITIES,
    type Severity,
} from "./types.ts";

function realOrSame(path: string): string {
    try {
        return realpathSync(path);
    } catch {
        return path;
    }
}

// The roots that name the machine's user: the home directory, and the temp directory in the forms
// a tool may quote (`os.tmpdir()`, its resolved form, and the fixed `/tmp` and `/private/tmp`),
// since a temp path such as `/private/tmp/claude-501/-Users-name-...` carries the user's name.
function machineRoots(): Map<string, string> {
    const home = homedir();
    const temp = [tmpdir(), realOrSame(tmpdir()), "/tmp", "/private/tmp"];
    const roots = new Map<string, string>(temp.map((root) => [root, "$TMPDIR"]));
    if (home.length > 1) {
        roots.set(home, "~");
    }
    return roots;
}

const byLength = (a: string, b: string): number => b.length - a.length;

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Names the home directory as `~` and the temp directory as `$TMPDIR`, wherever a root starts a
// path (never inside one, so `/home/x/tmp` is left alone). A path outside home, temp, the
// repository and the report directory stays as the tool wrote it: it names nothing of the user.
export function hideMachinePaths(text: string): string {
    const roots = machineRoots();
    const longestFirst = [...roots.keys()].filter((root) => root.length > 1).sort(byLength);
    if (longestFirst.length === 0) {
        return text;
    }
    const pattern = new RegExp(
        `(?<![\\w.~/-])(${longestFirst.map(escapeRegExp).join("|")})(?![\\w.-])`,
        "g",
    );
    return text.replace(pattern, (root) => roots.get(root) ?? root);
}

// A reason or an error that quotes a path names it from the report directory, or from `~`.
function scrubber(dir: string): (text: string) => string {
    return (text) => hideMachinePaths(text.replaceAll(`${dir}/`, "").replaceAll(dir, "."));
}

function scrubOutcome(
    scrub: (text: string) => string,
): (outcome: ReviewerOutcome) => ReviewerOutcome {
    return (outcome) => ({
        ...outcome,
        ...(outcome.reason === undefined ? {} : { reason: scrub(outcome.reason) }),
        ...(outcome.dropped === undefined
            ? {}
            : {
                  dropped: outcome.dropped.map((dropped) => ({
                      entry: scrub(dropped.entry),
                      reason: scrub(dropped.reason),
                  })),
              }),
    });
}

// A reviewer's free text quotes the paths it saw; the id, reporters and location stay as they are.
function scrubItem<T extends Finding | Doubt>(scrub: (text: string) => string, item: T): T {
    return {
        ...item,
        title: scrub(item.title),
        statement: scrub(item.statement),
        ...(item.evidence === undefined ? {} : { evidence: scrub(item.evidence) }),
        ...(item.kind === "finding" && item.suggestedFix !== undefined
            ? { suggestedFix: scrub(item.suggestedFix) }
            : {}),
    };
}

function scrubbed(report: Report, dir: string): Report {
    const scrub = scrubber(resolve(dir));
    const { reason } = report.walkthrough;
    return {
        ...report,
        reviewers: report.reviewers.map(scrubOutcome(scrub)),
        walkthrough:
            reason === undefined
                ? report.walkthrough
                : { ...report.walkthrough, reason: scrub(reason) },
        findings: report.findings.map((finding) => scrubItem(scrub, finding)),
        doubts: report.doubts.map((doubt) => scrubItem(scrub, doubt)),
        errors: report.errors.map(scrub),
    };
}

// Both files, or an error when the directory cannot take them: the one case with no report.
export function writeReport(dir: string, report: Report): Result<Report> {
    const value = scrubbed(report, dir);
    try {
        writeFileSync(join(dir, "report.json"), `${JSON.stringify(value, null, 2)}\n`);
        writeFileSync(join(dir, "report.md"), renderReport(value));
        return { ok: true, value };
    } catch (error) {
        return { ok: false, error: `writing the report: ${(error as Error).message}` };
    }
}

const oneLine = (text: string): string => text.replace(/\s+/g, " ").trim();

function lineRange(location: Extract<Location, { scope: "line" }>): string {
    const lines =
        location.startLine === location.endLine
            ? `${location.startLine}`
            : `${location.startLine}-${location.endLine}`;
    return `\`${location.file}:${lines}\`${location.side === "old" ? " (old side)" : ""}`;
}

function where(location: Location): string {
    if (location.scope === "change") {
        return "the whole change";
    }
    return location.scope === "file" ? `\`${location.file}\`` : lineRange(location);
}

function engineText(engine: Engine): string {
    const extras = (["model", "effort", "level"] as const)
        .filter((key) => engine[key] !== undefined)
        .map((key) => `${key} ${engine[key]}`);
    return [`${engine.tool} ${engine.version}`, ...extras].join(", ");
}

function seconds(durationMs: number | undefined): string[] {
    return durationMs === undefined ? [] : [`${(durationMs / 1000).toFixed(1)} s`];
}

function droppedLines(outcome: ReviewerOutcome): string[] {
    return (outcome.dropped ?? []).map(
        (dropped) => `  - dropped "${oneLine(dropped.entry)}": ${oneLine(dropped.reason)}`,
    );
}

function reviewerLine(outcome: ReviewerOutcome): string {
    const details = [
        ...(outcome.engine === undefined ? [] : [engineText(outcome.engine)]),
        ...seconds(outcome.durationMs),
    ];
    const head = `- \`${outcome.reviewer}\`${details.length > 0 ? ` (${details.join(", ")})` : ""}`;
    return outcome.reason === undefined ? head : `${head}: ${oneLine(outcome.reason)}`;
}

const OUTCOME_HEADINGS = [
    ["reported", "Ran"],
    ["skipped", "Skipped"],
    ["failed", "Failed"],
] as const;

function reviewersSection(reviewers: readonly ReviewerOutcome[]): string[] {
    return OUTCOME_HEADINGS.flatMap(([outcome, heading]) => {
        const lines = reviewers
            .filter((entry) => entry.outcome === outcome)
            .flatMap((entry) => [reviewerLine(entry), ...droppedLines(entry)]);
        return lines.length === 0 ? [] : [`${heading}:`, "", ...lines, ""];
    });
}

function findingLine(finding: Finding): string {
    const by = finding.reporters.map((reporter) => `\`${reporter.id}\``).join(", ");
    return `- ${oneLine(finding.title)}, at ${where(finding.location)} (${by})`;
}

function severitySection(findings: readonly Finding[], severity: Severity): string[] {
    const lines = findings.filter((entry) => entry.severity === severity).map(findingLine);
    return lines.length === 0 ? [] : [`### ${severity}`, "", ...lines, ""];
}

function findingsSection(findings: readonly Finding[]): string[] {
    const sections = SEVERITIES.flatMap((severity) => severitySection(findings, severity));
    return ["## Findings", "", ...(sections.length === 0 ? ["None.", ""] : sections)];
}

function doubtLine(doubt: Doubt): string {
    return `- ${oneLine(doubt.title)}, at ${where(doubt.location)} (\`${doubt.id}\`)`;
}

function listSection(title: string, lines: readonly string[]): string[] {
    return [`## ${title}`, "", ...(lines.length === 0 ? ["None."] : lines), ""];
}

function tierLine({ tier }: Report): string {
    return tier.reason === undefined
        ? `Tier ${tier.used}, as measured.`
        : `Tier ${tier.used}, raised from the measured ${tier.measured}: ${oneLine(tier.reason)}`;
}

function securityLine({ security }: Report): string {
    if (!security.triggered) {
        return "No security pattern matched.";
    }
    const matches = security.matches.map(
        (match) =>
            `\`${match.pattern}\` at \`${match.file}${match.line === undefined ? "" : `:${match.line}`}\``,
    );
    return `The security reviewer joined: ${matches.join("; ")}.`;
}

function subjectLines({ subject, measure }: Report): string[] {
    const dirty = subject.dirty ? " Uncommitted changes were left out of the review." : "";
    return [
        `# Review of ${subject.repo}, \`${subject.branch}\``,
        "",
        `Against \`${subject.base}\` (${subject.baseSource}), from \`${subject.mergeBase.slice(0, 12)}\` to \`${subject.head.slice(0, 12)}\`: ${measure.lines} lines in ${measure.files} files.${dirty}`,
        "",
    ];
}

function guideLine({ walkthrough }: Report): string {
    return walkthrough.guide === null
        ? `No guide: ${oneLine(walkthrough.reason ?? "none was written")}.`
        : `\`${walkthrough.guide}\`, checked against \`${walkthrough.patch}\`; its page is \`${walkthrough.html}\`.`;
}

export function renderReport(report: Report): string {
    return [
        ...subjectLines(report),
        tierLine(report),
        "",
        securityLine(report),
        "",
        "## Reviewers",
        "",
        ...reviewersSection(report.reviewers),
        ...findingsSection(report.findings),
        ...listSection("Doubts", report.doubts.map(doubtLine)),
        "## Walkthrough guide",
        "",
        guideLine(report),
        "",
        ...listSection(
            "Errors",
            report.errors.map((error) => `- ${oneLine(error)}`),
        ),
    ]
        .join("\n")
        .replace(/\n+$/, "\n");
}
