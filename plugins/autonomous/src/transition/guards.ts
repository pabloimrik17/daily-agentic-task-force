// The guards on leaving implement or verify (spec autonomous-run, "Leaving implement needs the
// work finished" and "Leaving verify needs the work finished"; design D6): in the task's
// workspace, the change has no unchecked task, the working tree is clean and the branch is
// pushed. Every reason that holds comes back, so one run tells the human all there is to finish.

import { access } from "node:fs/promises";

import type { AttemptRecord, AttemptWorkspace, TaskRef } from "../attempts/record.ts";
import { listRecords } from "../attempts/state.ts";
import type { Exec } from "../exec.ts";
import type { PullRequestsFactory } from "../pull-request/port.ts";
import type { Result } from "../result.ts";
import { findBranchChange } from "../stages/openspec-change.ts";
import type { TransitionStage } from "./mode.ts";

export interface GuardTools {
    git: Exec; // run with `-C <directory>`
    openspecIn: (directory: string) => Exec; // `openspec` takes its root from its working directory
    pullRequests: PullRequestsFactory;
}

interface TaskCount {
    completed: number;
    total: number;
}

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

// The reasons that stop a task leaving the stage; none for the stages without guards.
export async function guardsOnLeaving(
    from: TransitionStage,
    ref: TaskRef,
    state: string,
    tools: GuardTools,
): Promise<string[]> {
    return from === "implement" || from === "verify" ? workGuards(ref, state, tools) : [];
}

async function workGuards(ref: TaskRef, state: string, tools: GuardTools): Promise<string[]> {
    const found = await workspaceOf(state, ref);
    if (!found.ok) {
        return [found.error];
    }
    const { path, branch } = found.value;
    // Pruned, so a deleted remote branch cannot pass the unpushed check through a stale ref.
    const fetched = await tools.git(["-C", path, "fetch", "--prune", "origin"]);
    const reasons: (string | null)[] = [
        fetched.ok ? null : `fetching origin in the workspace: ${fetched.error}`,
    ];
    reasons.push(await uncheckedTasks(path, tools));
    reasons.push(await uncommittedChanges(path, tools.git));
    reasons.push(await unpushedCommits(path, branch, tools.git));
    return reasons.filter((reason) => reason !== null);
}

// Every stage of a task shares one workspace, so the latest record of any stage holds it. The
// latest is by creation time: `attempt` counts per stage.
async function workspaceOf(state: string, ref: TaskRef): Promise<Result<AttemptWorkspace>> {
    let records: AttemptRecord[];
    try {
        records = await listRecords(state);
    } catch (error) {
        return { ok: false, error: `reading the attempts: ${message(error)}` };
    }
    const created = (record: AttemptRecord) => record.history[0]?.at ?? "";
    const [latest] = records
        .filter((record) => record.task.source === ref.source && record.task.id === ref.id)
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

async function unpushedCommits(path: string, branch: string, git: Exec): Promise<string | null> {
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
