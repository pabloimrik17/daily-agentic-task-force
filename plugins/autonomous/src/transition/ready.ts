// Spec autonomous-run, "The transition into external-review marks the pull request ready" and
// "Entering external-review needs no failed check"; design D13 of add-external-review-stage.

import type { TaskRef } from "../attempts/record.ts";
import type { Result } from "../result.ts";
import { failedCheck, type GuardTools, readChecks, workspaceOf } from "./guards.ts";

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
    const { number, pullRequests, state: pullRequest, checks } = read.value;
    if (checks.failed.length > 0) {
        const failed = checks.failed.map((run) => failedCheck(run, pullRequest.head.sha));
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
