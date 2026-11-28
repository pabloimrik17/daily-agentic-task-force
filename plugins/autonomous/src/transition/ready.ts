// Spec autonomous-run, "The transition into external-review marks the pull request ready" and
// "Entering external-review needs no failed check"; design D13 of add-external-review-stage.

import type { TaskRef } from "../attempts/record.ts";
import type { Result } from "../result.ts";
import {
    type CheckedPullRequest,
    failedCheck,
    type GuardTools,
    readChecks,
    workspaceOf,
} from "./guards.ts";

const failedOf = ({ state, checks }: CheckedPullRequest) =>
    checks.failed.map((run) => failedCheck(run, state.head.sha));

// What stops a task entering external-review before it is asked: the checks of its pull request
// that failed, each named, or why they could not be read. A task with no workspace on this machine
// refuses nothing here, as in markReady; the guards on leaving the stage speak for it.
export async function failedChecksOnEntry(
    state: string,
    ref: TaskRef,
    tools: GuardTools,
): Promise<string[]> {
    const found = await workspaceOf(state, ref);
    if (!found.ok) {
        return [];
    }
    const read = await readChecks(found.value, tools);
    return read.ok ? failedOf(read.value) : [read.error];
}

// Null once the pull request is ready, or the reason it was left as it is: this machine holds no
// workspace of the task, and the wait's repair marks it where one does (design D5). A failed check
// or a failed marking is the error. A check still running refuses nothing: an AFK code review
// transitions seconds after its last push.
export async function markReady(
    state: string,
    ref: TaskRef,
    tools: GuardTools,
): Promise<Result<string | null>> {
    const found = await workspaceOf(state, ref);
    if (!found.ok) {
        return {
            ok: true,
            value: `the pull request was not marked ready for review: ${found.error}`,
        };
    }
    const read = await readChecks(found.value, tools);
    if (!read.ok) {
        return read;
    }
    const { number, pullRequests, state: pullRequest } = read.value;
    const failed = failedOf(read.value);
    if (failed.length > 0) {
        return { ok: false, error: failed.join("; ") };
    }
    if (!pullRequest.draft) {
        return { ok: true, value: null };
    }
    const marked = await pullRequests.ready(number);
    return marked.ok
        ? { ok: true, value: null }
        : { ok: false, error: `marking pull request #${number} ready for review: ${marked.error}` };
}
