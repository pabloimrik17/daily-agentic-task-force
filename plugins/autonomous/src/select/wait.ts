// The wait for the review bots (spec work-selection, "Candidates and exclusions"; spec review-bots,
// "The pull request of a task in external-review" and "A draft pull request in external-review is
// marked ready"; design D5). The pull request is found as the transition guards find it.

import type { PullRequest, PullRequests, PullRequestsFactory } from "../pull-request/port.ts";
import type { Result } from "../result.ts";
import { type ExternalReviewRead, readExternalReview } from "../review-bots/read.ts";
import type { ExternalReviewConfig } from "../review-bots/types.ts";
import { workspaceOf } from "../transition/guards.ts";
import type { ReviewBotsWait, WorkTask } from "./types.ts";

interface WaitDeps {
    config: ExternalReviewConfig;
    state: string; // the state directory, whose attempt records name the workspace
    pullRequests: PullRequestsFactory;
    apply: boolean; // only then is a draft marked ready
    now: Date;
}

// Null when the task's pull request is settled.
export type ReviewBotsCheck = (task: WorkTask) => Promise<ReviewBotsWait | null>;

interface Found {
    port: PullRequests;
    pullRequest: PullRequest;
}

async function pullRequestOf(task: WorkTask, deps: WaitDeps): Promise<Result<Found>> {
    const workspace = await workspaceOf(deps.state, { source: task.source, id: task.id });
    if (!workspace.ok) {
        return workspace;
    }
    const { path, branch } = workspace.value;
    const port = deps.pullRequests(path);
    const found = await port.find(branch);
    if (!found.ok) {
        return {
            ok: false,
            error: `cannot find the pull request of the branch ${branch}: ${found.error}`,
        };
    }
    return found.value === null
        ? { ok: false, error: `the branch ${branch} has no open pull request` }
        : { ok: true, value: { port, pullRequest: found.value } };
}

function link({ number, url }: PullRequest): ReviewBotsWait["pullRequest"] {
    return { number, url };
}

function unreadable(pullRequest: PullRequest | null, error: string): ReviewBotsWait {
    return {
        pullRequest: pullRequest === null ? null : link(pullRequest),
        draft: null,
        bots: [],
        running: [],
        reasons: [error],
    };
}

function waitOf(
    pullRequest: PullRequest,
    read: ExternalReviewRead,
    draft: ReviewBotsWait["draft"],
): ReviewBotsWait {
    return {
        pullRequest: link(pullRequest),
        draft,
        bots: read.bots,
        running: read.checks.running.map(({ name }) => name),
        reasons: read.settled.reasons,
    };
}

// Either way the task waits this run: marking it ready starts the review bots' wait (design D4).
async function draftWait(
    found: Found,
    read: ExternalReviewRead,
    deps: WaitDeps,
): Promise<ReviewBotsWait> {
    const { port, pullRequest } = found;
    if (!deps.apply) {
        return waitOf(pullRequest, read, "left-draft");
    }
    const marked = await port.ready(pullRequest.number);
    if (!marked.ok) {
        const wait = waitOf(pullRequest, read, "left-draft");
        const reason = `cannot mark pull request #${pullRequest.number} ready: ${marked.error}`;
        return { ...wait, reasons: [reason, ...wait.reasons] };
    }
    const again = await readExternalReview(port, pullRequest.number, deps.config, deps.now);
    const wait = again.ok
        ? waitOf(pullRequest, again.value, "marked-ready")
        : unreadable(pullRequest, again.error);
    return { ...wait, draft: "marked-ready" };
}

export function reviewBotsCheck(deps: WaitDeps): ReviewBotsCheck {
    return async (task) => {
        const found = await pullRequestOf(task, deps);
        if (!found.ok) {
            return unreadable(null, found.error);
        }
        const { port, pullRequest } = found.value;
        const read = await readExternalReview(port, pullRequest.number, deps.config, deps.now);
        if (!read.ok) {
            return unreadable(pullRequest, read.error);
        }
        if (read.value.draft) {
            return draftWait(found.value, read.value, deps);
        }
        return read.value.settled.settled ? null : waitOf(pullRequest, read.value, null);
    };
}
