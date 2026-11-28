// Spec autonomous-run, "Leaving implement/verify/code-review needs the work finished" and "Leaving
// external-review needs a quiet round"; designs D6, D13, and D14 of add-external-review-stage.
// Every reason that holds comes back, so one run tells the human all there is to finish.

import { access } from "node:fs/promises";

import {
    type AttemptRecord,
    type AttemptWorkspace,
    isTaskRecord,
    type TaskRef,
} from "../attempts/record.ts";
import { listRecords } from "../attempts/state.ts";
import type { Exec } from "../exec.ts";
import { plural } from "../label-triage/render.ts";
import type {
    CheckRun,
    PullRequests,
    PullRequestsFactory,
    PullRequestState,
} from "../pull-request/port.ts";
import type { Result } from "../result.ts";
import { type PullRequestChecks, pullRequestChecks } from "../review-bots/classify.ts";
import type { ReviewBot } from "../review-bots/types.ts";
import { findBranchChange } from "../stages/openspec-change.ts";
import { unpublishedReasons } from "./receipt.ts";
import { type TransitionStage, transitionRow } from "./table.ts";

export interface GuardTools {
    git: Exec; // run with `-C <directory>`
    openspecIn: (directory: string) => Exec; // `openspec` takes its root from its working directory
    pullRequests: PullRequestsFactory;
    bots: readonly ReviewBot[]; // their check runs are not checks of the pull request
}

// The task's open pull request and the checks of its head commit.
export interface CheckedPullRequest {
    number: number;
    pullRequests: PullRequests;
    state: PullRequestState;
    checks: PullRequestChecks;
}

interface TaskCount {
    completed: number;
    total: number;
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

// The reasons that stop a task leaving the stage; none for a stage the table does not guard.
export async function guardsOnLeaving(
    from: TransitionStage,
    ref: TaskRef,
    state: string,
    tools: GuardTools,
): Promise<string[]> {
    if (!transitionRow(from).guarded) {
        return [];
    }
    const found = await workspaceOf(state, ref);
    if (!found.ok) {
        return [found.error];
    }
    const work = await workGuards(found.value, tools);
    return from === "external-review"
        ? [...work, ...(await roundGuards(found.value, ref, state, tools))]
        : work;
}

async function workGuards(
    { path, branch }: AttemptWorkspace,
    tools: GuardTools,
): Promise<string[]> {
    // Pruned, so a deleted remote branch cannot pass the unpushed check through a stale ref.
    const fetched = await tools.git(["-C", path, "fetch", "--prune", "origin"]);
    const reasons = [
        fetched.ok ? null : `fetching origin in the workspace: ${fetched.error}`,
        await uncheckedTasks(path, tools),
        await uncommittedChanges(path, tools.git),
        await unpushedCommits(path, branch, tools.git),
    ];
    return reasons.filter((reason) => reason !== null);
}

// D14: the open attempt's publish receipt is current and a quiet round's, and every check of the
// head commit has ended without failing.
async function roundGuards(
    workspace: AttemptWorkspace,
    ref: TaskRef,
    state: string,
    tools: GuardTools,
): Promise<string[]> {
    const unpublished = await unpublishedReasons(state, ref, "external-review", true);
    const read = await readChecks(workspace, tools);
    const sha = read.ok ? read.value.state.head.sha : "";
    const checks = read.ok
        ? [
              ...read.value.checks.failed.map((run) => failedCheck(run, sha)),
              ...read.value.checks.running.map(
                  (run) => `the check ${run.name} has not ended on ${sha}`,
              ),
          ]
        : [read.error];
    return [...(unpublished.ok ? unpublished.value : [unpublished.error]), ...checks];
}

export const failedCheck = (run: CheckRun, sha: string) =>
    `the check ${run.name} concluded ${run.conclusion} on ${sha}`;

// A review bot's check run is not a check of the pull request (spec review-bots, "The checks of a
// pull request").
export async function readChecks(
    { path, branch }: AttemptWorkspace,
    tools: GuardTools,
): Promise<Result<CheckedPullRequest>> {
    const pullRequests = tools.pullRequests(path);
    const found = await pullRequests.find(branch);
    if (!found.ok) {
        return { ok: false, error: `finding the pull request of ${branch}: ${found.error}` };
    }
    if (found.value === null) {
        return { ok: false, error: `the branch ${branch} has no open pull request` };
    }
    const { number } = found.value;
    const state = await pullRequests.state(number);
    if (!state.ok) {
        return {
            ok: false,
            error: `cannot read the state of pull request #${number}: ${state.error}`,
        };
    }
    const runs = await pullRequests.checkRuns(state.value.head.sha);
    if (!runs.ok) {
        return {
            ok: false,
            error: `cannot read the check runs of pull request #${number}: ${runs.error}`,
        };
    }
    const checks = pullRequestChecks(runs.value, tools.bots);
    return { ok: true, value: { number, pullRequests, state: state.value, checks } };
}

// Every stage of a task shares one workspace, so the latest record of any stage holds it. The
// latest is by creation time: `attempt` counts per stage.
export async function workspaceOf(state: string, ref: TaskRef): Promise<Result<AttemptWorkspace>> {
    let records: AttemptRecord[];
    try {
        records = await listRecords(state);
    } catch (error) {
        return { ok: false, error: `reading the attempts: ${message(error)}` };
    }
    const created = (record: AttemptRecord) => record.history[0]?.at ?? "";
    const [latest] = records
        .filter((record) => isTaskRecord(record, ref))
        .sort((a, b) => created(b).localeCompare(created(a)));
    if (latest === undefined) {
        return { ok: false, error: `there is no workspace to check: the task has no attempt` };
    }
    const { workspace } = latest;
    try {
        await access(workspace.path);
    } catch {
        return {
            ok: false,
            error: `there is no workspace to check: ${workspace.path} no longer exists`,
        };
    }
    return { ok: true, value: workspace };
}

async function uncheckedTasks(path: string, tools: GuardTools): Promise<string | null> {
    const base = await tools.pullRequests(path).defaultBranch();
    if (!base.ok) {
        return `reading the default branch: ${base.error}`;
    }
    const change = await findBranchChange(tools.git, {
        directory: path,
        base: base.value,
        ref: "HEAD",
    });
    if (!change.ok) {
        return change.error;
    }
    const listed = await tools.openspecIn(path)(["list", "--json"]);
    if (!listed.ok) {
        return `listing the OpenSpec changes: ${listed.error}`;
    }
    const counted = countOf(listed.stdout, change.value);
    if (!counted.ok) {
        return counted.error;
    }
    const { completed, total } = counted.value;
    return completed < total
        ? `the change ${change.value} has ${total - completed} of ${plural(total, "task")} unchecked`
        : null;
}

function countOf(stdout: string, name: string): Result<TaskCount> {
    let parsed: unknown;
    try {
        parsed = JSON.parse(stdout);
    } catch (error) {
        return { ok: false, error: `openspec list printed no JSON: ${message(error)}` };
    }
    const changes = (parsed as { changes?: unknown } | null)?.changes;
    const listed = Array.isArray(changes) ? (changes as unknown[]) : [];
    const entry = listed.find((item) => (item as { name?: unknown } | null)?.name === name) as
        | { completedTasks?: unknown; totalTasks?: unknown }
        | undefined;
    const { completedTasks, totalTasks } = entry ?? {};
    if (typeof completedTasks !== "number" || typeof totalTasks !== "number") {
        return { ok: false, error: `openspec list reports no task count for the change ${name}` };
    }
    return { ok: true, value: { completed: completedTasks, total: totalTasks } };
}

async function uncommittedChanges(path: string, git: Exec): Promise<string | null> {
    // An explicit mode, so status.showUntrackedFiles=no cannot hide new files.
    const status = await git(["-C", path, "status", "--porcelain", "--untracked-files=normal"]);
    if (!status.ok) {
        return `reading the working tree status: ${status.error}`;
    }
    const changed = status.stdout.split("\n").filter((line) => line.trim() !== "").length;
    return changed === 0 ? null : `the working tree has ${plural(changed, "uncommitted change")}`;
}

// Also a precondition of publish mode: a thread can only be anchored to pushed lines.
export async function unpushedCommits(
    path: string,
    branch: string,
    git: Exec,
): Promise<string | null> {
    const remote = `origin/${branch}`;
    const exists = await git(["-C", path, "rev-parse", "--verify", "--quiet", remote]);
    if (!exists.ok) {
        return `the branch ${branch} has no remote branch ${remote}, so its commits are unpushed`;
    }
    const ahead = await git(["-C", path, "rev-list", "--count", `${remote}..HEAD`]);
    if (!ahead.ok) {
        return `counting the commits ${remote} lacks: ${ahead.error}`;
    }
    const count = Number(ahead.stdout.trim());
    if (!Number.isInteger(count)) {
        return `counting the commits ${remote} lacks: git printed ${JSON.stringify(ahead.stdout.trim())}`;
    }
    return count === 0
        ? null
        : `the branch ${branch} has ${plural(count, "commit")} ${remote} lacks`;
}
