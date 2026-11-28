// Everything publish mode reads before its first post (spec autonomous-run, "Publish
// preconditions"; spec finding-threads, "An invalid record publishes nothing"; design D6, D9 and
// Risks): the open code-review or external-review attempt, its whole record, the pull request with no pending review
// of this account, the pushed branch, the final diff and the threads. Any failure posts nothing.

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { readOpenAttempt } from "../attempts/open.ts";
import type { AttemptId, AttemptRecord } from "../attempts/record.ts";
import type { AutonomousConfig } from "../config.ts";
import type { Exec } from "../exec.ts";
import type {
    PullRequest,
    PullRequests,
    PullRequestsFactory,
    ReviewThread,
} from "../pull-request/port.ts";
import type { Result } from "../result.ts";
import { findBranchChange } from "../stages/openspec-change.ts";
import { unpushedCommits } from "../transition/guards.ts";
import { type DiffFile, parseDiff } from "./anchor.ts";
import { digestOf, FINDINGS_FILE } from "./receipt.ts";
import { type FindingsRecord, parseFindingsRecord, type RecordOptions } from "./record.ts";
import type { PublishReport } from "./report.ts";

export interface PrepareDeps {
    config: AutonomousConfig;
    state: string;
    pullRequests: PullRequestsFactory;
    git: Exec; // run with `-C <directory>`
}

type FoundAttempt = Pick<Attempt, "record" | "dir">;

interface Attempt {
    record: AttemptRecord;
    dir: string;
    findings: FindingsRecord;
    digest: string; // of the exact findings.json bytes read
}

interface FinalDiff {
    patch: string;
    files: DiffFile[];
    change: string;
}

export interface Prepared extends Attempt, FinalDiff {
    port: PullRequests;
    pullRequest: PullRequest;
    threads: ReviewThread[];
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

const PUBLISHED_STAGES: readonly string[] = ["code-review", "external-review"];

// An external review's record names the reporters of its report: `ci` and the review bots
// (design D7 of add-external-review-stage).
function recordOptions(record: AttemptRecord, config: AutonomousConfig): RecordOptions {
    return record.stage === "external-review"
        ? { reporters: ["ci", ...config.review.external.bots.map(({ id }) => id)] }
        : {};
}

// Everything publish mode reads after `findAttempt`, the findings first: the caller holds the
// attempt's publication lock, so the record it publishes is the one its receipt names.
export async function prepare(
    found: FoundAttempt,
    deps: PrepareDeps,
    report: PublishReport,
): Promise<Result<Prepared>> {
    const { record, dir } = found;
    const findings = await readFindings(dir, record.id, recordOptions(record, deps.config));
    if (!findings.ok) {
        return findings;
    }
    const read: Attempt = { record, dir, ...findings.value };
    const port = deps.pullRequests(record.workspace.path);
    const open = await openPullRequest(port, record, deps.git, report);
    if (!open.ok) {
        return open;
    }
    const diff = await finalDiff(port, record.workspace.path, deps.git);
    if (!diff.ok) {
        return diff;
    }
    const threads = await port.threads(open.value.number);
    return threads.ok
        ? {
              ok: true,
              value: {
                  ...read,
                  ...diff.value,
                  port,
                  pullRequest: open.value,
                  threads: threads.value,
              },
          }
        : threads;
}

// The attempt's record and directory, which name the lock; nothing of the findings yet.
export async function findAttempt(
    attempt: AttemptId,
    deps: PrepareDeps,
    report: PublishReport,
): Promise<Result<FoundAttempt>> {
    const found = await readOpenAttempt(deps.state, attempt, deps.config);
    if (!found.ok) {
        return found;
    }
    const { record, dir } = found.value;
    report.task = { ...record.task };
    if (!PUBLISHED_STAGES.includes(record.stage)) {
        return {
            ok: false,
            error: `attempt ${attempt} belongs to the ${record.stage} stage; publish mode publishes ${PUBLISHED_STAGES.join(" and ")} attempts only`,
        };
    }
    return { ok: true, value: { record, dir } };
}

// The digest is of the bytes validated, so the receipt names exactly the record published.
async function readFindings(
    dir: string,
    attempt: AttemptId,
    options: RecordOptions,
): Promise<Result<Pick<Attempt, "findings" | "digest">>> {
    const file = join(dir, FINDINGS_FILE);
    let bytes: Buffer;
    try {
        bytes = await readFile(file);
    } catch (error) {
        const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
        return {
            ok: false,
            error: missing ? `${file} is missing` : `cannot read ${file}: ${messageOf(error)}`,
        };
    }
    const parsed = parseFindingsRecord(bytes.toString("utf8"), file, options);
    if (!parsed.ok) {
        return parsed;
    }
    return parsed.value.attempt === attempt
        ? { ok: true, value: { findings: parsed.value, digest: digestOf(bytes) } }
        : {
              ok: false,
              error: `${file} is invalid: $.attempt names ${parsed.value.attempt}, not ${attempt}`,
          };
}

async function openPullRequest(
    port: PullRequests,
    record: AttemptRecord,
    git: Exec,
    report: PublishReport,
): Promise<Result<PullRequest>> {
    const { branch } = record.workspace;
    const found = await port.find(branch);
    if (!found.ok) {
        return found;
    }
    if (found.value === null) {
        return {
            ok: false,
            error: `no open pull request for branch ${branch}: run --pull-request <attempt> first`,
        };
    }
    const pullRequest = found.value;
    const { number, url } = pullRequest;
    report.pullRequest = { number, url };
    const unpushed = await pushed(record.workspace.path, branch, git);
    if (unpushed !== null) {
        return { ok: false, error: unpushed };
    }
    const pending = await port.pendingReview(number);
    if (!pending.ok) {
        return pending;
    }
    return pending.value === null
        ? { ok: true, value: pullRequest }
        : {
              ok: false,
              error: `pull request #${number} holds a pending review of this account, ${pending.value}: submit or delete it, then publish again`,
          };
}

// A thread can only be anchored to pushed lines. Fetched and pruned first, as the guards on
// leaving a stage do; the reason names the unpushed commits.
async function pushed(path: string, branch: string, git: Exec): Promise<string | null> {
    const fetched = await git(["-C", path, "fetch", "--prune", "origin"]);
    if (!fetched.ok) {
        return `fetching origin in the workspace: ${fetched.error}`;
    }
    const reason = await unpushedCommits(path, branch, git);
    if (reason === null) {
        return null;
    }
    const listed = await git(["-C", path, "log", "--format=%h", `origin/${branch}..HEAD`]);
    const ids = listed.ok ? listed.stdout.split("\n").filter((line) => line.trim() !== "") : [];
    return ids.length === 0 ? reason : `${reason}: ${ids.join(", ")}`;
}

// The diff of the pull request: from the merge base with its base branch, the repository's
// default one, to HEAD, with the walkthrough's fixed prefixes.
async function finalDiff(port: PullRequests, path: string, git: Exec): Promise<Result<FinalDiff>> {
    const base = await port.defaultBranch();
    if (!base.ok) {
        return base;
    }
    const mergeBase = await git(["-C", path, "merge-base", `origin/${base.value}`, "HEAD"]);
    if (!mergeBase.ok) {
        return {
            ok: false,
            error: `finding the merge base with origin/${base.value}: ${mergeBase.error}`,
        };
    }
    const diff = await git([
        "-C",
        path,
        "diff",
        "--no-color",
        "--no-ext-diff",
        "--src-prefix=a/",
        "--dst-prefix=b/",
        mergeBase.stdout.trim(),
        "HEAD",
    ]);
    if (!diff.ok) {
        return { ok: false, error: `computing the final diff: ${diff.error}` };
    }
    const change = await findBranchChange(git, { directory: path, base: base.value, ref: "HEAD" });
    return change.ok
        ? {
              ok: true,
              value: { patch: diff.stdout, files: parseDiff(diff.stdout), change: change.value },
          }
        : change;
}
