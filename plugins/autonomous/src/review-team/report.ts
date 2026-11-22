// The report a review writes (spec review-team, "The report"; design D11):
// `report.json`, which follows `autonomous.review-report.v1`, and a short
// `report.md` for a person. Neither names an absolute path or the home
// directory: reasons that quote a tool's message are made relative first.

import { writeFileSync } from "node:fs";
import { homedir } from "node:os";
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

// A reason or an error that quotes a path names it from the report directory, or from `~`.
function scrubber(dir: string): (text: string) => string {
    const home = homedir();
    return (text) => {
        const relative = text.replaceAll(`${dir}/`, "").replaceAll(dir, ".");
        return home.length > 1 ? relative.replaceAll(home, "~") : relative;
    };
}

function scrubOutcome(
    scrub: (text: string) => string,
): (outcome: ReviewerOutcome) => ReviewerOutcome {
    return (outcome) =>
        outcome.reason === undefined ? outcome : { ...outcome, reason: scrub(outcome.reason) };
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
        const lines = reviewers.filter((entry) => entry.outcome === outcome).map(reviewerLine);
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
