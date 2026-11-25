// The shapes the review team's modules share (spec review-team; design D2 to
// D4 and D10 to D12). Reviewers write a `ReviewerFile`; `collect` stamps the
// id, the reviewer, the engine and the severity, and writes the `Report`.

export const FINDING_SCHEMA = "autonomous.finding.v1";
export const REPORT_SCHEMA = "autonomous.review-report.v1";
export const PLAN_SCHEMA = "autonomous.review-plan.v1";

export const REVIEWER_IDS = [
    "walkthrough",
    "code-review",
    "codex",
    "coderabbit",
    "fallow-review",
    "tests-lens",
    "security-review",
] as const;
export type ReviewerId = (typeof REVIEWER_IDS)[number];

export const TIERS = ["S", "M", "L"] as const;
export type Tier = (typeof TIERS)[number];

export const SEVERITIES = ["CRITICAL", "WARNING", "SUGGESTION"] as const;
export type Severity = (typeof SEVERITIES)[number];

// Paths are relative to the repository root, with forward slashes.
export type Location =
    | { scope: "line"; file: string; startLine: number; endLine: number; side: "new" | "old" }
    | { scope: "file"; file: string }
    | { scope: "change" };

export interface Engine {
    tool: string;
    version: string;
    model?: string;
    effort?: string;
    level?: string;
}

// What a reviewer writes, in its own words: no id, no severity on our scale.
export interface RawFinding {
    kind: "finding";
    title: string; // one line
    statement: string; // one to three sentences
    location: Location;
    evidence: string;
    label: "issue" | "suggestion";
    nativeSeverity: string;
    suggestedFix?: string;
}

export interface RawDoubt {
    kind: "doubt";
    title: string; // one line
    statement: string;
    location: Location;
    label: "question";
    evidence?: string;
}

export type RawItem = RawFinding | RawDoubt;

// An entry of a reviewer's own output that the runner left out, with the reason: today only a
// Codex entry whose path is outside the repository.
export interface DroppedEntry {
    entry: string;
    reason: string;
}

// `reviewers/<id>.json`. A teammate always writes the reported form; `run <id>`
// writes the skipped form when its tool fails, times out or cannot be parsed.
export type ReviewerFile =
    | {
          schema: typeof FINDING_SCHEMA;
          reviewer: ReviewerId;
          outcome: "reported";
          durationMs?: number;
          items: RawItem[];
          dropped?: DroppedEntry[]; // written only when non-empty
      }
    | {
          schema: typeof FINDING_SCHEMA;
          reviewer: ReviewerId;
          outcome: "skipped";
          reason: string;
          durationMs?: number;
      };

export interface Reporter {
    reviewer: ReviewerId;
    id: string;
}

export interface Finding extends RawFinding {
    id: string; // `<reviewer>-<n>`, n from 1 in the reviewer's own order
    reviewer: ReviewerId;
    engine: Engine;
    severity: Severity;
    reporters: Reporter[]; // itself first, then every exact duplicate grouped into it
}

export interface Doubt extends RawDoubt {
    id: string;
    reviewer: ReviewerId;
    engine: Engine;
}

export interface TierThreshold {
    maxLines: number;
    maxFiles: number;
}

export interface TeamRow {
    reviewer: ReviewerId;
    model?: string;
    effort?: string;
    level?: string;
}

// The `review` block of the configuration. Patterns are JavaScript regular
// expression sources: path patterns match a changed path, case-insensitively,
// and line patterns match an added line.
export interface ReviewConfig {
    tiers: { S: TierThreshold; M: TierThreshold };
    team: Record<Tier, TeamRow[]>;
    security: { pathPatterns: string[]; linePatterns: string[]; model?: string; effort?: string };
}

export interface Subject {
    repo: string; // the repository directory's name, never its path
    branch: string;
    base: string; // the base ref's name
    baseSource: "given" | "pull-request" | "default-branch";
    mergeBase: string;
    head: string;
    dirty: boolean; // uncommitted changes exist and are left out of the review
}

export interface Measure {
    lines: number; // added plus deleted
    files: number;
}

export interface TierChoice {
    measured: Tier;
    used: Tier;
    reason?: string; // set when the caller raised the tier
}

export interface SecurityMatch {
    kind: "path" | "line";
    pattern: string;
    file: string;
    line?: number; // the new-side line number, for a line match
}

export interface PlannedReviewer {
    reviewer: ReviewerId;
    angle: string;
    kind: "cli" | "teammate";
    required: boolean;
    engine: Engine;
    brief?: string; // a teammate's filled brief, relative to the report directory
    output: string; // `reviewers/<id>.json`, relative to the report directory
}

export interface SkippedReviewer {
    reviewer: ReviewerId;
    reason: string;
}

// `plan.json`. It holds no absolute path: `run` and `collect` take the report
// directory as `--dir` and the repository from the working directory.
export interface Plan {
    schema: typeof PLAN_SCHEMA;
    createdAt: string; // ISO 8601, UTC
    subject: Subject;
    status: string; // `git status --porcelain` at plan time, for collect's comparison
    fingerprint: string; // sha256 of the tree's contents at plan time: catches a re-edit status misses
    measure: Measure;
    tier: TierChoice;
    security: { triggered: boolean; matches: SecurityMatch[] };
    team: PlannedReviewer[];
    skipped: SkippedReviewer[];
    guide: { available: boolean; reason?: string }; // whether `plannotator` can validate the guide
}

export interface ReviewerOutcome {
    reviewer: ReviewerId;
    outcome: "reported" | "skipped" | "failed"; // failed: a required reviewer wrote nothing valid
    reason?: string;
    required: boolean;
    engine?: Engine; // absent for a reviewer skipped at plan time
    durationMs?: number;
    dropped?: DroppedEntry[]; // entries its runner left out, with the reason
}

export interface WalkthroughGuide {
    guide: string | null; // `walkthrough.json`, or null when no valid guide exists
    patch?: string;
    html?: string;
    reason?: string; // why no guide exists
}

export interface Report {
    schema: typeof REPORT_SCHEMA;
    subject: Subject;
    measure: Measure;
    tier: TierChoice;
    security: { triggered: boolean; matches: SecurityMatch[] };
    reviewers: ReviewerOutcome[];
    findings: Finding[];
    doubts: Doubt[];
    walkthrough: WalkthroughGuide;
    errors: string[]; // a required reviewer failed, or the tree or HEAD changed
}

// A request the CLI refuses with exit code 2, as opposed to an error (exit 1).
export type Refusable<T> = { ok: true; value: T } | { ok: false; error: string; refused?: true };
