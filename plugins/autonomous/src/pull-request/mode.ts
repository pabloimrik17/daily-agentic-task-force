// Takes no run lock: it writes the cover beside the attempt record, never the record.
// Every step is safe to repeat: a run cut short after the push finds the branch ahead and
// pushes again.

import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { readOpenAttempt } from "../attempts/open.ts";
import type { AttemptId, AttemptRecord } from "../attempts/record.ts";
import type { AutonomousConfig } from "../config.ts";
import type { Result } from "../result.ts";
import type { WorkReader, WorkTask } from "../select/types.ts";
import { cover } from "./cover.ts";
import {
    EMPTY_COMMIT_SUBJECT,
    type PullRequest,
    type PullRequests,
    type PullRequestsFactory,
} from "./port.ts";
import { blankPullRequest, type PullRequestReport } from "./report.ts";

const COVER_FILE = "cover.md";

export interface PullRequestDeps {
    config: AutonomousConfig;
    state: string;
    work: WorkReader[];
    pullRequests: PullRequestsFactory;
}

interface Ready {
    record: AttemptRecord;
    dir: string;
    task: WorkTask; // after detail(): children, url and parent filled
}

type Checked = { ok: true; value: Ready } | { ok: false; reasons: string[] };

interface Opening extends Ready {
    title: string | undefined;
    pullRequests: PullRequests;
    report: PullRequestReport;
    base: string;
    found: PullRequest | null;
    ahead: number;
}

// A step returns the reason it stopped, or null when it did its part.
type OpeningStep = (opening: Opening) => Promise<string | null>;

const LOOK_UP: readonly OpeningStep[] = [readBase, findOpen];
const REUSE: readonly OpeningStep[] = [writeCover, reuse];
// The split check comes before the title: a parent of a split opens nothing, so needs no title.
const OPEN: readonly OpeningStep[] = [
    countAhead,
    requireTitle,
    ensureCommit,
    pushBranch,
    writeCover,
    openDraft,
];

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

export async function runPullRequest(
    attempt: AttemptId,
    title: string | undefined,
    deps: PullRequestDeps,
    startedAt: Date,
): Promise<PullRequestReport> {
    const report = blankPullRequest(attempt, startedAt);
    const checked = await check(attempt, deps, report);
    if (!checked.ok) {
        return { ...report, reasons: checked.reasons };
    }
    const opening: Opening = {
        ...checked.value,
        title,
        pullRequests: deps.pullRequests(checked.value.record.workspace.path),
        report,
        base: "",
        found: null,
        ahead: 0,
    };
    const stopped =
        (await runSteps(LOOK_UP, opening)) ?? (await runSteps(branchSteps(opening), opening));
    if (stopped !== null) {
        report.reasons.push(stopped);
    }
    report.outcome = report.pullRequest !== null || !report.needed ? "advance" : "not-evaluable";
    return report;
}

function branchSteps(opening: Opening): readonly OpeningStep[] {
    return opening.found === null ? OPEN : REUSE;
}

async function runSteps(steps: readonly OpeningStep[], opening: Opening): Promise<string | null> {
    for (const step of steps) {
        const stopped = await step(opening);
        if (stopped !== null) {
            return stopped;
        }
    }
    return null;
}

async function check(
    attempt: AttemptId,
    deps: PullRequestDeps,
    report: PullRequestReport,
): Promise<Checked> {
    const found = await readOpenAttempt(deps.state, attempt, deps.config);
    if (!found.ok) {
        return { ok: false, reasons: [found.error] };
    }
    const { record, dir } = found.value;
    report.branch = record.workspace.branch;
    const read = await readTask(deps.work, record);
    if (!read.ok) {
        return { ok: false, reasons: [read.error] };
    }
    const { source, id, title } = read.value;
    report.task = { source, id, title };
    return { ok: true, value: { record, dir, task: read.value } };
}

async function readTask(
    readers: readonly WorkReader[],
    record: AttemptRecord,
): Promise<Result<WorkTask>> {
    const { source, id } = record.task;
    const reader = readers.find((candidate) => candidate.source === source);
    if (reader === undefined) {
        return { ok: false, error: `${source} is not enabled` };
    }
    const listed = await reader.list();
    if (!listed.ok) {
        return { ok: false, error: `${source}: ${listed.error}` };
    }
    const task = listed.value.find((candidate) => candidate.id === id);
    if (task === undefined) {
        return { ok: false, error: `${source}:${id} is not an open task` };
    }
    const detailed = await reader.detail(task);
    return detailed.ok ? detailed : { ok: false, error: `${source}: ${detailed.error}` };
}

function titled(title: string, task: WorkTask): string {
    const suffix = ` (${task.id})`;
    return title.endsWith(suffix) ? title : `${title}${suffix}`;
}

function coverFile(opening: Opening): string {
    return join(opening.dir, COVER_FILE);
}

async function readBase(opening: Opening): Promise<string | null> {
    const read = await opening.pullRequests.defaultBranch();
    if (!read.ok) {
        return read.error;
    }
    opening.base = read.value;
    opening.report.base = read.value;
    return null;
}

async function findOpen(opening: Opening): Promise<string | null> {
    const found = await opening.pullRequests.find(opening.record.workspace.branch);
    if (!found.ok) {
        return found.error;
    }
    opening.found = found.value;
    return null;
}

// Rewritten on every run, so the description follows the task.
async function writeCover(opening: Opening): Promise<string | null> {
    const file = coverFile(opening);
    try {
        await writeFile(file, cover(opening.task, opening.task.parent ?? null));
        return null;
    } catch (error) {
        return `cannot write ${file}: ${messageOf(error)}`;
    }
}

async function reuse(opening: Opening): Promise<string | null> {
    const found = opening.found!; // REUSE runs only when the lookup found one
    const title = opening.title === undefined ? undefined : titled(opening.title, opening.task);
    const bodyFile = coverFile(opening);
    const edited = await opening.pullRequests.edit(
        found.number,
        title === undefined ? { bodyFile } : { title, bodyFile },
    );
    if (!edited.ok) {
        return edited.error;
    }
    const { number, url } = found;
    opening.report.pullRequest = { number, url, title: title ?? found.title, action: "reused" };
    return null;
}

function requireTitle(opening: Opening): Promise<string | null> {
    return Promise.resolve(
        opening.title === undefined
            ? "a title is required to open the pull request: pass --title"
            : null,
    );
}

async function countAhead(opening: Opening): Promise<string | null> {
    const { pullRequests, base, task, report } = opening;
    const ahead = await pullRequests.ahead(base);
    if (!ahead.ok) {
        return ahead.error;
    }
    opening.ahead = ahead.value;
    const children = task.children ?? [];
    if (ahead.value > 0 || children.length === 0) {
        return null;
    }
    report.needed = false;
    return `${task.source}:${task.id} is the parent of a split with nothing to show: its subtasks ${children.join(", ")} are open and ${opening.record.workspace.branch} has no commit ahead of ${base}`;
}

// Any other branch with nothing to show gets an empty commit, so the pull request can exist.
async function ensureCommit(opening: Opening): Promise<string | null> {
    if (opening.ahead > 0) {
        return null;
    }
    const message = `${EMPTY_COMMIT_SUBJECT}${opening.task.id}`;
    const committed = await opening.pullRequests.emptyCommit(message);
    if (!committed.ok) {
        return committed.error;
    }
    opening.report.emptyCommit = true;
    return null;
}

async function pushBranch(opening: Opening): Promise<string | null> {
    const pushed = await opening.pullRequests.push(opening.record.workspace.branch);
    return pushed.ok ? null : pushed.error;
}

async function openDraft(opening: Opening): Promise<string | null> {
    const opened = await opening.pullRequests.open({
        base: opening.base,
        branch: opening.record.workspace.branch,
        title: titled(opening.title!, opening.task), // OPEN runs requireTitle first
        bodyFile: coverFile(opening),
    });
    if (!opened.ok) {
        return opened.error;
    }
    const { number, url, title } = opened.value;
    opening.report.pullRequest = { number, url, title, action: "opened" };
    return null;
}
