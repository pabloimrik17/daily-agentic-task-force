// Writes files beside the attempt record and never the record, so it takes no run lock. Its own
// lock keeps two publications of one attempt apart.

import { access, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { acquireLockAt } from "../attempts/lock.ts";
import { readOpenAttempt } from "../attempts/open.ts";
import type { AttemptId, AttemptRecord } from "../attempts/record.ts";
import {
    logbookEntryPath,
    logbookLockPath,
    logbookReceiptPath,
    writeJsonAtomic,
} from "../attempts/state.ts";
import type { AutonomousConfig } from "../config.ts";
import type { Trackers } from "../label-triage/trackers/tracker.ts";
import { isAutonomyLabel } from "../label-contract/contract.ts";
import type { PullRequest, PullRequests, PullRequestsFactory } from "../pull-request/port.ts";
import { READ_BACK_TRIES, readUntil, type Wait } from "../read-back.ts";
import type { Result } from "../result.ts";
import { stageFor } from "../stages/registry.ts";
import { readTransitioned } from "../transition/transitioned.ts";
import { checkBody } from "./body.ts";
import { renderHeader } from "./header.ts";
import { hasEntry, LOGGED_SCHEMA, logbookMarker } from "./marker.ts";
import { blankLog, type LogReport } from "./report.ts";

const COMMENT_FILE = "logbook-comment.md";

export interface LogDeps {
    config: AutonomousConfig;
    state: string;
    trackers: Trackers;
    pullRequests: PullRequestsFactory;
    home: string;
    wait?: Wait;
}

interface Ready {
    record: AttemptRecord;
    dir: string;
    body: string;
    port: PullRequests;
    pullRequest: PullRequest;
}

type Checked = { ok: true; value: Ready } | { ok: false; reasons: string[] };

interface Logging extends Ready {
    deps: LogDeps;
    report: LogReport;
    header: string;
}

// A step returns the reason it failed, or null when it did its part.
type LogStep = (logging: Logging) => Promise<string | null>;

const STEPS: readonly LogStep[] = [buildHeader, postEntry, confirmEntry, writeReceipt];

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

export async function runLog(
    attempt: AttemptId,
    deps: LogDeps,
    startedAt: Date,
): Promise<LogReport> {
    const report = blankLog(attempt, startedAt);
    const checked = await check(attempt, deps, report);
    if (!checked.ok) {
        report.reasons.push(...checked.reasons);
        return report;
    }
    const logging: Logging = { ...checked.value, deps, report, header: "" };
    const failure = await logLocked(logging);
    if (failure !== null) {
        report.reasons.push(failure);
        return report;
    }
    report.outcome = "advance";
    return report;
}

async function check(attempt: AttemptId, deps: LogDeps, report: LogReport): Promise<Checked> {
    const found = await readOpenAttempt(deps.state, attempt, deps.config);
    if (!found.ok) {
        return { ok: false, reasons: [found.error] };
    }
    const { record, dir } = found.value;
    report.task = { ...record.task };
    const body = await readBody(dir, deps.home, report);
    if (!body.ok) {
        return body;
    }
    const port = deps.pullRequests(record.workspace.path);
    const open = await findPullRequest(port, record.workspace.branch, report);
    if (!open.ok) {
        return { ok: false, reasons: [open.error] };
    }
    return { ok: true, value: { record, dir, body: body.value, port, pullRequest: open.value } };
}

async function readBody(
    dir: string,
    home: string,
    report: LogReport,
): Promise<{ ok: true; value: string } | { ok: false; reasons: string[] }> {
    const file = logbookEntryPath(dir);
    const text = await readFile(file, "utf8").catch((error: unknown) => unreadable(file, error));
    if (typeof text !== "string") {
        return { ok: false, reasons: [text.reason] };
    }
    if (text.trim() === "") {
        return { ok: false, reasons: [`${file} is empty`] };
    }
    const { words, broken } = checkBody(text, home);
    report.words = words;
    return broken.length === 0 ? { ok: true, value: text } : { ok: false, reasons: broken };
}

function unreadable(file: string, error: unknown): { reason: string } {
    const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
    return { reason: missing ? `${file} is missing` : `cannot read ${file}: ${messageOf(error)}` };
}

async function findPullRequest(
    port: PullRequests,
    branch: string,
    report: LogReport,
): Promise<Result<PullRequest>> {
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
    const { number, url } = found.value;
    report.pullRequest = { number, url };
    return { ok: true, value: found.value };
}

async function logLocked(logging: Logging): Promise<string | null> {
    const lock = await acquireLockAt(logbookLockPath(logging.dir));
    if (!lock.ok) {
        return lock.error;
    }
    try {
        return await log(logging);
    } finally {
        await lock.release();
    }
}

async function log(logging: Logging): Promise<string | null> {
    const { port, pullRequest, record, report } = logging;
    const listed = await port.comments(pullRequest.number);
    if (!listed.ok) {
        return listed.error;
    }
    if (hasEntry(listed.value, record.id)) {
        report.entry = "existing";
        return keepReceipt(logging);
    }
    for (const step of STEPS) {
        const failure = await step(logging);
        if (failure !== null) {
            return failure;
        }
    }
    return null;
}

// Every value comes from the record, its files, the tracker and the branch, never the body.
async function buildHeader(logging: Logging): Promise<string | null> {
    const { record, report } = logging;
    const stage = stageFor(record.stage);
    if (stage === undefined) {
        return `stage ${record.stage} is not registered, so its entry has no heading`;
    }
    const start = record.history.find((entry) => entry.state === "started")?.at ?? null;
    const autonomy = await readAutonomy(logging);
    if (!autonomy.ok) {
        return autonomy.error;
    }
    const commits = await readCommits(logging.port, start);
    if (!commits.ok) {
        return commits.error;
    }
    logging.header = renderHeader({
        attempt: record.id,
        stage: record.stage,
        emoji: stage.emoji,
        number: record.attempt,
        autonomy: autonomy.value,
        agentArgs: record.agentArgs,
        start,
        end: report.startedAt,
        answer: await readAnswer(logging),
        commits: commits.value,
    });
    return null;
}

// Read from the tracker now: the answer may have changed the labels since launch.
async function readAutonomy({ deps, record, report }: Logging): Promise<Result<string | null>> {
    const read = await deps.trackers[record.task.source].readTask(record.task.id);
    if (!read.ok) {
        return read;
    }
    const { source, id, title, labels } = read.value;
    report.task = { source, id, title };
    return { ok: true, value: labels.find(isAutonomyLabel) ?? null };
}

// Commits since the start are an approximation.
async function readCommits(port: PullRequests, start: string | null): Promise<Result<string[]>> {
    if (start === null) {
        return { ok: true, value: [] };
    }
    const base = await port.defaultBranch();
    return base.ok ? port.commitsSince(base.value, start) : base;
}

// A malformed transition.json costs the header its answer, not the entry.
async function readAnswer({ dir, report }: Logging): Promise<string[] | null> {
    const read = await readTransitioned(dir);
    if (!read.ok) {
        report.notes.push(`${read.error}; the header leaves the answer out`);
        return null;
    }
    return read.value === null ? null : read.value.answer;
}

async function postEntry(logging: Logging): Promise<string | null> {
    const { dir, header, body, port, pullRequest, report } = logging;
    const file = join(dir, COMMENT_FILE);
    try {
        await writeFile(file, `${header}\n\n${body.trim()}\n`);
    } catch (error) {
        return `cannot write ${file}: ${messageOf(error)}`;
    }
    const posted = await port.comment(pullRequest.number, file);
    if (!posted.ok) {
        return posted.error;
    }
    report.entry = "published";
    return null;
}

async function confirmEntry({ deps, record, port, pullRequest }: Logging): Promise<string | null> {
    const back = await readUntil(
        () => port.comments(pullRequest.number),
        (comments) => hasEntry(comments, record.id),
        deps.wait,
    );
    if (!back.ok) {
        return back.error;
    }
    return hasEntry(back.value, record.id)
        ? null
        : `pull request #${pullRequest.number}: no comment starting with ${logbookMarker(record.id)} was found when read back (${READ_BACK_TRIES})`;
}

async function keepReceipt(logging: Logging): Promise<string | null> {
    const file = logbookReceiptPath(logging.dir);
    try {
        await access(file);
    } catch {
        return writeReceipt(logging);
    }
    logging.report.receipt = file;
    return null;
}

async function writeReceipt({ dir, record, pullRequest, report }: Logging): Promise<string | null> {
    const file = logbookReceiptPath(dir);
    const { number, url } = pullRequest;
    try {
        await writeJsonAtomic(file, {
            schema: LOGGED_SCHEMA,
            attempt: record.id,
            pullRequest: { number, url },
            at: report.startedAt,
        });
    } catch (error) {
        return `cannot write the receipt ${file}: ${messageOf(error)}`;
    }
    report.receipt = file;
    return null;
}
