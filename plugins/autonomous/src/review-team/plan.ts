// The plan of a review (spec review-team, "The review tier is measured from the diff", "A tier
// can be raised, never lowered", "A reviewer that cannot run is skipped and recorded" and "The
// report"; design D1, D5 to D7 and D11). Code composes the subject, the tier, the security
// trigger, the team and its availability, then writes the report directory's `plan.json` and
// one filled brief per teammate. A refused tier stops it before anything is checked or written.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { CLI_TIMEOUT_MS, type Exec } from "../exec.ts";
import type { Result } from "../result.ts";
import {
    type Availability,
    type AvailabilityDeps,
    checkAvailability,
    engineVersion,
    guideAvailability,
} from "./availability.ts";
import { chooseTier, measureDiff, tierOf } from "./measure.ts";
import { REGISTRY } from "./registry.ts";
import { securityMatches } from "./security.ts";
import { gitStatus, resolveSubject } from "./subject.ts";
import { resolveTeam } from "./team.ts";
import {
    type Engine,
    type Measure,
    type Plan,
    PLAN_SCHEMA,
    type PlannedReviewer,
    type Refusable,
    type ReviewConfig,
    type SkippedReviewer,
    type Subject,
    type TeamRow,
    type Tier,
    type TierChoice,
} from "./types.ts";

// Availability and version checks are read-only and short (design D7).
const CHECK_TIMEOUT_MS = 30_000;

// What `/code-review` is run at when the tier row names no level.
const DEFAULT_LEVEL = "medium";

export interface PlanDeps {
    exec: (command: string, timeoutMs: number) => Exec; // bound to the repository
    repoRoot: string;
    home: string;
    tmpdir: string;
    now: () => Date;
    exists: (path: string) => boolean;
    fallowPlugin: () => Promise<boolean>;
    review: ReviewConfig;
    briefsDir: string; // skills/review-team/reviewers
}

export interface PlanRequest {
    base?: string;
    tier?: Tier;
    reason?: string;
    dir?: string;
}

interface Measured {
    subject: Subject;
    status: string;
    measure: Measure;
    tier: TierChoice;
}

interface Composed {
    team: PlannedReviewer[];
    rows: TeamRow[];
    skipped: SkippedReviewer[];
}

async function measured(request: PlanRequest, deps: PlanDeps): Promise<Refusable<Measured>> {
    const git = deps.exec("git", CLI_TIMEOUT_MS);
    const subject = await resolveSubject(
        { git, gh: deps.exec("gh", CLI_TIMEOUT_MS), repoRoot: deps.repoRoot },
        request.base,
    );
    if (!subject.ok) {
        return subject;
    }
    const status = await gitStatus(git);
    if (!status.ok) {
        return status;
    }
    const measure = await measureDiff(git, subject.value.mergeBase, subject.value.head);
    if (!measure.ok) {
        return measure;
    }
    const requested =
        request.tier === undefined ? undefined : { tier: request.tier, reason: request.reason };
    const tier = chooseTier(tierOf(measure.value, deps.review.tiers), requested);
    return tier.ok
        ? {
              ok: true,
              value: {
                  subject: subject.value,
                  status: status.value,
                  measure: measure.value,
                  tier: tier.value,
              },
          }
        : tier;
}

function availabilityDeps(deps: PlanDeps): AvailabilityDeps {
    return {
        exec: (command) => deps.exec(command, CHECK_TIMEOUT_MS),
        exists: deps.exists,
        home: deps.home,
        repoRoot: deps.repoRoot,
        fallowPlugin: deps.fallowPlugin,
    };
}

// One version call per tool: the five teammates share Claude Code's.
function versions(checks: AvailabilityDeps): (tool: string) => Promise<string> {
    const seen = new Map<string, Promise<string>>();
    return (tool) => {
        const version = seen.get(tool) ?? engineVersion(tool, checks);
        seen.set(tool, version);
        return version;
    };
}

function engineOf(row: TeamRow, tool: string, version: string): Engine {
    const { model, effort, level } = row;
    return {
        tool,
        version,
        ...(model === undefined ? {} : { model }),
        ...(effort === undefined ? {} : { effort }),
        ...(level === undefined ? {} : { level }),
    };
}

async function planned(
    row: TeamRow,
    version: (tool: string) => Promise<string>,
): Promise<PlannedReviewer> {
    const entry = REGISTRY[row.reviewer];
    const reviewer: PlannedReviewer = {
        reviewer: entry.id,
        angle: entry.angle,
        kind: entry.kind,
        required: entry.required,
        engine: engineOf(row, entry.tool, await version(entry.tool)),
        output: `reviewers/${entry.id}.json`,
    };
    return entry.kind === "teammate" ? { ...reviewer, brief: `briefs/${entry.id}.md` } : reviewer;
}

// The built-in /security-review takes no base and always diffs against origin/HEAD, so with
// another base it would review a different diff.
async function onDefaultBranch(git: Exec, subject: Subject): Promise<boolean> {
    const head = await git(["symbolic-ref", "refs/remotes/origin/HEAD"]);
    return head.ok
        ? head.stdout.trim().replace(/^refs\/remotes\/origin\//, "") === subject.base
        : subject.baseSource === "default-branch";
}

async function securityApplies(
    rows: TeamRow[],
    git: Exec,
    subject: Subject,
): Promise<Availability> {
    if (!rows.some((row) => row.reviewer === "security-review")) {
        return { available: true };
    }
    return (await onDefaultBranch(git, subject))
        ? { available: true }
        : {
              available: false,
              reason: `not applicable: /security-review always reviews against the default branch, and the base is ${subject.base}`,
          };
}

async function composeTeam(
    rows: TeamRow[],
    checks: AvailabilityDeps,
    security: Availability,
): Promise<Composed> {
    const checked = await Promise.all(
        rows.map(async (row) => ({
            row,
            availability:
                row.reviewer === "security-review" && !security.available
                    ? security
                    : await checkAvailability(row.reviewer, checks),
        })),
    );
    const version = versions(checks);
    const composed: Composed = { team: [], rows: [], skipped: [] };
    for (const { row, availability } of checked) {
        if (availability.available) {
            composed.team.push(await planned(row, version));
            composed.rows.push(row);
        } else {
            composed.skipped.push({ reviewer: row.reviewer, reason: availability.reason });
        }
    }
    return composed;
}

// A file-system-safe UTC time, to the second: 20261122T195501Z.
function stamp(date: Date): string {
    return date
        .toISOString()
        .replace(/[-:]/g, "")
        .replace(/\.\d+Z$/, "Z");
}

function reportDir(request: PlanRequest, deps: PlanDeps, subject: Subject, now: Date): string {
    return (
        request.dir ??
        join(
            deps.tmpdir,
            "review-team",
            `${subject.repo}-${subject.head.slice(0, 7)}-${stamp(now)}`,
        )
    );
}

function placeholders(dir: string, subject: Subject, row: TeamRow): Record<string, string> {
    return {
        OUTPUT: join(dir, "reviewers", `${row.reviewer}.json`),
        BASE: subject.base,
        MERGE_BASE: subject.mergeBase,
        HEAD: subject.head,
        LEVEL: row.level ?? DEFAULT_LEVEL,
        GUIDE_OUTPUT: join(dir, "walkthrough.json"),
        REVIEWER: row.reviewer,
        NATIVE_SEVERITIES: Object.keys(REGISTRY[row.reviewer].severity).join(", "),
    };
}

// An unknown placeholder would reach the teammate as literal text, so it is an error.
function fill(brief: string, values: Record<string, string>, name: string): Result<string> {
    const unknown = new Set<string>();
    const filled = brief.replace(/\{\{([^{}]*)\}\}/g, (match, key: string) => {
        if (Object.hasOwn(values, key)) {
            return values[key]!;
        }
        unknown.add(match);
        return match;
    });
    return unknown.size === 0
        ? { ok: true, value: filled }
        : {
              ok: false,
              error: `the brief ${name} has unknown placeholders: ${[...unknown].join(", ")}`,
          };
}

function readBrief(path: string): Result<string> {
    try {
        return { ok: true, value: readFileSync(path, "utf8") };
    } catch (error) {
        return { ok: false, error: `cannot read the brief ${path}: ${(error as Error).message}` };
    }
}

function fillBriefs(
    rows: TeamRow[],
    briefsDir: string,
    dir: string,
    subject: Subject,
): Result<Map<string, string>> {
    const briefs = new Map<string, string>();
    for (const row of rows) {
        const name = REGISTRY[row.reviewer].brief;
        if (name === undefined) {
            continue;
        }
        const brief = readBrief(join(briefsDir, name));
        const filled = brief.ok ? fill(brief.value, placeholders(dir, subject, row), name) : brief;
        if (!filled.ok) {
            return filled;
        }
        briefs.set(`briefs/${row.reviewer}.md`, filled.value);
    }
    return { ok: true, value: briefs };
}

// A directory of our own naming must be new; one the caller names may already exist.
function writeDirectory(dir: string, owned: boolean, files: Map<string, string>): Result<void> {
    try {
        mkdirSync(dirname(dir), { recursive: true });
        mkdirSync(dir, { recursive: !owned });
        for (const sub of ["briefs", "reviewers", "raw"]) {
            mkdirSync(join(dir, sub), { recursive: true });
        }
        for (const [path, content] of files) {
            writeFileSync(join(dir, path), content);
        }
        return { ok: true, value: undefined };
    } catch (error) {
        return {
            ok: false,
            error: `writing the report directory ${dir}: ${(error as Error).message}`,
        };
    }
}

export async function buildPlan(
    request: PlanRequest,
    deps: PlanDeps,
): Promise<Refusable<{ dir: string; plan: Plan }>> {
    const base = await measured(request, deps);
    if (!base.ok) {
        return base;
    }
    const { subject } = base.value;
    const git = deps.exec("git", CLI_TIMEOUT_MS);
    const security = await securityMatches(
        git,
        subject.mergeBase,
        subject.head,
        deps.review.security,
    );
    if (!security.ok) {
        return security;
    }
    const triggered = security.value.length > 0;
    const checks = availabilityDeps(deps);
    const rows = resolveTeam(
        base.value.tier.used,
        deps.review.team,
        deps.review.security,
        triggered,
    );
    const composed = await composeTeam(rows, checks, await securityApplies(rows, git, subject));
    const now = deps.now();
    const dir = reportDir(request, deps, subject, now);
    const briefs = fillBriefs(composed.rows, deps.briefsDir, dir, subject);
    if (!briefs.ok) {
        return briefs;
    }
    const plan: Plan = {
        schema: PLAN_SCHEMA,
        createdAt: now.toISOString(),
        ...base.value,
        security: { triggered, matches: security.value },
        team: composed.team,
        skipped: composed.skipped,
        guide: await guideAvailability(checks),
    };
    const files = new Map(briefs.value).set("plan.json", `${JSON.stringify(plan, null, 2)}\n`);
    const written = writeDirectory(dir, request.dir === undefined, files);
    return written.ok ? { ok: true, value: { dir, plan } } : written;
}
