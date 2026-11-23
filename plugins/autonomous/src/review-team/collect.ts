// Collecting the review team's output into its report (spec review-team, "The
// review team only reports", "The plugin's own reviewers are required",
// "Output is validated at run time", "Exact duplicates are grouped" and
// "Doubts are reported apart"; design D3, D10 and D11). Code validates, stamps
// and groups exact duplicates; nothing here judges a finding.

import { existsSync, statSync } from "node:fs";
import { join } from "node:path";

import type { Exec } from "../exec.ts";
import type { Result } from "../result.ts";
import { validateGuide } from "./guide.ts";
import { readJson, readPlan } from "./plan-file.ts";
import { REGISTRY } from "./registry.ts";
import { writeReport } from "./report.ts";
import { parseReviewerFile } from "./schema.ts";
import { deriveSeverity } from "./severity.ts";
import { gitStatus, insideRepository } from "./subject.ts";
import {
    type Doubt,
    type DroppedEntry,
    type Finding,
    type Plan,
    type PlannedReviewer,
    type RawItem,
    type Report,
    REPORT_SCHEMA,
    type ReviewerFile,
    type ReviewerOutcome,
    type Severity,
    type SkippedReviewer,
    type WalkthroughGuide,
} from "./types.ts";

export interface CollectDeps {
    git: Exec; // bound to the repository
    plannotator: Exec; // bound to the repository: guide export reads provenance from git there
}

type FileRead = { ok: true; file: ReviewerFile } | { ok: false; reason: string };

interface Gathered {
    row: PlannedReviewer;
    outcome: ReviewerOutcome;
    items: RawItem[];
    errors: string[];
}

function checked(row: PlannedReviewer, parsed: Result<ReviewerFile>): FileRead {
    if (!parsed.ok) {
        return {
            ok: false,
            reason: `wrote ${row.output}, which failed validation: ${parsed.error}`,
        };
    }
    if (parsed.value.reviewer !== row.reviewer) {
        return {
            ok: false,
            reason: `wrote ${row.output} as reviewer "${parsed.value.reviewer}" instead of "${row.reviewer}"`,
        };
    }
    return { ok: true, file: parsed.value };
}

function readReviewerFile(path: string, row: PlannedReviewer): FileRead {
    if (!existsSync(path)) {
        return { ok: false, reason: `ended without writing its output (${row.output})` };
    }
    const json = readJson(path);
    return json.ok
        ? checked(row, parseReviewerFile(json.value))
        : { ok: false, reason: `wrote ${row.output}, which is not JSON: ${json.error}` };
}

// The file's own duration, else the time from the plan to the file's last write.
function durationOf(path: string, read: FileRead, createdAt: string): number | undefined {
    if (read.ok && read.file.durationMs !== undefined) {
        return read.file.durationMs;
    }
    return existsSync(path)
        ? Math.max(0, Math.round(statSync(path).mtimeMs - Date.parse(createdAt)))
        : undefined;
}

// What the file yields: its items and the entries its runner dropped, or the reason it yields
// none.
function verdictOf(read: FileRead): {
    items: RawItem[];
    dropped?: DroppedEntry[];
    reason?: string;
} {
    if (!read.ok) {
        return { items: [], reason: read.reason };
    }
    if (read.file.outcome === "skipped") {
        return { items: [], reason: read.file.reason };
    }
    return {
        items: read.file.items,
        ...(read.file.dropped === undefined ? {} : { dropped: read.file.dropped }),
    };
}

function notReported(
    row: PlannedReviewer,
    reason: string,
): Pick<Gathered, "errors"> & {
    outcome: Pick<ReviewerOutcome, "outcome" | "reason">;
} {
    return row.required
        ? {
              outcome: { outcome: "failed", reason },
              errors: [`the required reviewer ${row.reviewer} failed: ${reason}`],
          }
        : { outcome: { outcome: "skipped", reason }, errors: [] };
}

function gather(dir: string, plan: Plan, row: PlannedReviewer): Gathered {
    const path = join(dir, row.output);
    const read = readReviewerFile(path, row);
    const durationMs = durationOf(path, read, plan.createdAt);
    const verdict = verdictOf(read);
    const result =
        verdict.reason === undefined
            ? { outcome: { outcome: "reported" as const }, errors: [] }
            : notReported(row, verdict.reason);
    return {
        row,
        outcome: {
            reviewer: row.reviewer,
            ...result.outcome,
            required: row.required,
            engine: row.engine,
            ...(durationMs === undefined ? {} : { durationMs }),
            ...(verdict.dropped === undefined ? {} : { dropped: verdict.dropped }),
        },
        items: verdict.items,
        errors: result.errors,
    };
}

function skippedAtPlan(entry: SkippedReviewer): ReviewerOutcome {
    return {
        reviewer: entry.reviewer,
        outcome: "skipped",
        reason: entry.reason,
        required: REGISTRY[entry.reviewer].required,
    };
}

// Ids count findings and doubts together, from 1, in the reviewer's own order.
function stamp({ row, items }: Gathered): (Finding | Doubt)[] {
    return items.map((item, index) => {
        const own = {
            id: `${row.reviewer}-${index + 1}`,
            reviewer: row.reviewer,
            engine: row.engine,
        };
        return item.kind === "doubt"
            ? { ...item, ...own }
            : {
                  ...item,
                  ...own,
                  // parseReviewerFile rejects a native severity the table does not list.
                  severity: deriveSeverity(row.reviewer, item.nativeSeverity) as Severity,
                  reporters: [{ reviewer: row.reviewer, id: own.id }],
              };
    });
}

const isFinding = (entry: Finding | Doubt): entry is Finding => entry.kind === "finding";
const isDoubt = (entry: Finding | Doubt): entry is Doubt => entry.kind === "doubt";

function groupKey(finding: Finding): string | undefined {
    const { location } = finding;
    return location.scope === "line"
        ? JSON.stringify([
              location.file,
              location.startLine,
              location.endLine,
              finding.title.toLowerCase().replace(/\s+/g, " ").trim(),
          ])
        : undefined;
}

// Design D10: the first keeps its text and lists every reporter; anything less exact stays apart.
function groupDuplicates(findings: readonly Finding[]): Finding[] {
    const firsts = new Map<string, Finding>();
    return findings.filter((finding) => {
        const key = groupKey(finding);
        const first = key === undefined ? undefined : firsts.get(key);
        if (first !== undefined) {
            first.reporters.push({ reviewer: finding.reviewer, id: finding.id });
            return false;
        }
        if (key !== undefined) {
            firsts.set(key, finding);
        }
        return true;
    });
}

function lines(text: string): string[] {
    return text.split("\n").filter((line) => line.trim() !== "");
}

function statusChange(now: Result<string>, before: string): string[] {
    if (!now.ok) {
        return [`could not check the working tree: ${now.error}`];
    }
    const [was, is] = [lines(before), lines(now.value)];
    const changed = [
        ...is.filter((line) => !was.includes(line)).map((line) => `now "${line}"`),
        ...was.filter((line) => !is.includes(line)).map((line) => `no longer "${line}"`),
    ];
    return changed.length === 0
        ? []
        : [
              `the working tree changed since the plan (git status --porcelain: ${changed.join(", ")})`,
          ];
}

async function headChange(git: Exec, before: string): Promise<string[]> {
    const head = await git(["rev-parse", "HEAD"]);
    if (!head.ok) {
        return [`could not check HEAD: ${head.error}`];
    }
    const now = head.stdout.trim();
    return now === before ? [] : [`HEAD moved since the plan, from ${before} to ${now}`];
}

// The report directory, when it is inside the repository, is never a change of the tree.
async function leftOut(git: Exec, dir: string): Promise<string | undefined> {
    const root = await git(["rev-parse", "--show-toplevel"]);
    return root.ok ? insideRepository(root.stdout.trim(), dir) : undefined;
}

// Spec "The review team only reports": a reviewer that changed the tree or HEAD is an error.
async function changesSincePlan(git: Exec, plan: Plan, dir: string): Promise<string[]> {
    return [
        ...statusChange(await gitStatus(git, await leftOut(git, dir)), plan.status),
        ...(await headChange(git, plan.subject.head)),
    ];
}

function assemble(
    plan: Plan,
    gathered: readonly Gathered[],
    walkthrough: WalkthroughGuide,
    changes: readonly string[],
): Report {
    const stamped = gathered.flatMap(stamp);
    return {
        schema: REPORT_SCHEMA,
        subject: plan.subject,
        measure: plan.measure,
        tier: plan.tier,
        security: plan.security,
        reviewers: [...gathered.map((entry) => entry.outcome), ...plan.skipped.map(skippedAtPlan)],
        findings: groupDuplicates(stamped.filter(isFinding)),
        doubts: stamped.filter(isDoubt),
        walkthrough,
        errors: [...gathered.flatMap((entry) => entry.errors), ...changes],
    };
}

// `ok: false` only when no report could be written; a failed required reviewer
// and a changed tree or HEAD are entries of the report's `errors`.
export async function collect(dir: string, deps: CollectDeps): Promise<Result<Report>> {
    const plan = readPlan(dir);
    if (!plan.ok) {
        return plan;
    }
    // Checked before collect writes anything, in case the report directory is in the tree.
    const changes = await changesSincePlan(deps.git, plan.value, dir);
    const gathered = plan.value.team.map((row) => gather(dir, plan.value, row));
    const walkthrough = await validateGuide(dir, plan.value, deps);
    return writeReport(dir, assemble(plan.value, gathered, walkthrough, changes));
}
